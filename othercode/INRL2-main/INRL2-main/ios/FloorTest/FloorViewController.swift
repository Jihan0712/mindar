import ARKit
import UIKit
import Vision
import WebKit

/*
 * Camera + ARKit underneath, the web page on top. Bridge with the page:
 *
 * Phone → page, every camera frame: `__inrlNative.frame({...})` with
 *   cam    camera-to-world matrix (16 numbers, column-major, metres, y up)
 *   proj   projection matching the picture on screen
 *   hit    floor under the screen centre (matrix) or null
 *   anchor the placed scene's anchor (matrix, refined by ARKit) or null
 *   track  "normal" or why tracking is limited
 *   sent   when it was sent (ms since 1970), to measure the delay
 *
 * The web view shows the whole InRL web app (bridge version 2). The camera
 * and ARKit only run while a page asks for them (INRL of a post, /floor);
 * the other pages are ordinary, opaque web pages.
 *
 * Page → phone (`webkit.messageHandlers.inrl.postMessage`):
 *   {type: 'ready'}            start the camera + ARKit and send frames
 *   {type: 'stop'}             stop them (the page closed)
 *   {type: 'aim', y}           look for the surface at this height of the screen (0–1 from the top; default 0.5)
 *   {type: 'openSafari', url}  open a page of the InRL site in Safari (back to where the person came from)
 *   {type: 'trackImage', id, url, width}  follow this marker artwork (PNG, width a first guess in metres;
 *                               ARKit refines it); replaces the previous one
 *   {type: 'clearImage'}       stop following it
 *
 * Markers: Vision reads QR codes in the camera picture (4 times a second while the camera is
 * on) → `__inrlNative.qr(text)`. Once the page asked to track a marker's artwork, each frame
 * also has `image: {id, m, w, tracked}` (the artwork's centre, x right, y out of the print,
 * -z towards its top; w its estimated width in metres) or null.
 *   {type: 'anchor', m: [16]}  pin the scene there (replaces the previous)
 *   {type: 'clearAnchor'}
 *   {type: 'raycast', id, x, y} floor under a screen point (CSS px) →
 *                               `__inrlNative.raycastResult(id, matrix|null)`
 *   {type: 'haptic'}
 *   {type: 'reset'}            restart tracking
 *   {type: 'paste'}            use a phone key copied in Safari (fallback for the link)
 *
 * `inrlfloor://link#<phone key>` (from the InRL site in Safari) gives the web
 * view the same phone key as Safari, so the person's saved scenes show up.
 * `inrlfloor://open?path=/p/<id>/inrl…#<phone key>` does the same and opens
 * that page (INRL of a post, from Safari).
 */
final class FloorViewController: UIViewController, ARSessionDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    private let arView = ARSCNView()
    private let coaching = ARCoachingOverlayView()
    private var webView: WKWebView!
    /// A page is listening: camera on, frames flow.
    private var arActive = false
    /// The web page has finished loading at least once since the last navigation.
    private var pageLoaded = false
    private var pendingPath: String?
    /// Where `hit` looks for a surface: share of the screen height from the top.
    private var aimY: CGFloat = 0.5
    /// Frames sent but not yet run by the page; a few may overlap, a backlog may not.
    private var inFlight = 0
    private var sceneAnchor: ARAnchor?
    private var pendingKey: String?
    private let haptics = UIImpactFeedbackGenerator(style: .medium)
    /// The marker artwork ARKit follows (one at a time), and its id (the marker code).
    private var markerImage: ARReferenceImage?
    private var qrBusy = false
    private var lastQr: TimeInterval = 0
    private let qrQueue = DispatchQueue(label: "inrl.qr", qos: .userInitiated)

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        arView.frame = view.bounds
        arView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        arView.session.delegate = self
        arView.automaticallyUpdatesLighting = false
        arView.rendersCameraGrain = false
        view.addSubview(arView)

        coaching.session = arView.session
        coaching.goal = .horizontalPlane
        coaching.activatesAutomatically = true
        coaching.frame = view.bounds
        coaching.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        coaching.isUserInteractionEnabled = false
        view.addSubview(coaching)
        arView.isHidden = true
        coaching.isHidden = true

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(self, name: "inrl")
        config.userContentController.addUserScript(WKUserScript(
            source: "window.__inrlNativeApp = { version: 2 };",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.bounces = false
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.navigationDelegate = self
        webView.isInspectable = true
        view.addSubview(webView)

        let start = Bundle.main.object(forInfoDictionaryKey: "InRLStartURL") as? String
            ?? "https://inrl2.marine-469.workers.dev/"
        webView.load(URLRequest(url: URL(string: start)!))

        NotificationCenter.default.addObserver(forName: .inrlOpenURL, object: nil, queue: .main) { [weak self] _ in
            self?.takePendingLink()
        }
        takePendingLink()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        stopAR()
    }

    private func startAR() {
        arActive = true
        arView.isHidden = false
        coaching.isHidden = false
        runSession(reset: false)
    }

    private func stopAR() {
        arActive = false
        arView.session.pause()
        if let old = sceneAnchor { arView.session.remove(anchor: old) }
        sceneAnchor = nil
        markerImage = nil
        arView.isHidden = true
        coaching.isHidden = true
    }

    private func runSession(reset: Bool) {
        let config = ARWorldTrackingConfiguration()
        config.planeDetection = [.horizontal]
        config.isLightEstimationEnabled = true
        if let image = markerImage {
            config.detectionImages = [image]
            config.maximumNumberOfTrackedImages = 1
            config.automaticImageScaleEstimationEnabled = true
        }
        arView.session.run(config, options: reset ? [.resetTracking, .removeExistingAnchors] : [])
        if reset { sceneAnchor = nil }
    }

    // MARK: phone key hand-over

    private func takePendingLink() {
        guard let url = PendingLink.url else { return }
        PendingLink.url = nil
        if url.host == "open" {
            let path = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first { $0.name == "path" }?.value ?? "/"
            // Only pages of this site.
            guard path.hasPrefix("/") && !path.hasPrefix("//") else { return }
            pendingPath = path
            if let key = url.fragment, !key.isEmpty { use(key) } else { openPending() }
            return
        }
        guard url.host == "link", let key = url.fragment else { return }
        use(key)
    }

    /// Goes to the page asked for by an `open` link, once the web app has loaded.
    private func openPending() {
        guard pageLoaded, let path = pendingPath else { return }
        pendingPath = nil
        let js = "location.href = \(jsString(path))"
        webView.evaluateJavaScript(js)
    }

    private func jsString(_ s: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [s])
        let arr = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"/\"]"
        return String(arr.dropFirst().dropLast())
    }

    private func use(_ key: String) {
        let key = key.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard key.count == 48, key.allSatisfy({ $0.isHexDigit }) else {
            webView.evaluateJavaScript("window.__inrlNative && __inrlNative.error('That is not an InRL phone key')")
            return
        }
        if pageLoaded { applyKey(key) } else { pendingKey = key }
    }

    private func applyKey(_ key: String) {
        pendingKey = nil
        pageLoaded = false
        haptics.impactOccurred()
        // With an `open` link waiting, go there signed in; otherwise reload (the floor test's link).
        let next: String
        if let path = pendingPath {
            pendingPath = nil
            next = "location.href = \(jsString(path))"
        } else {
            next = "location.reload()"
        }
        webView.evaluateJavaScript("localStorage.setItem('inrl.owner', '\(key)'); localStorage.setItem('inrl.floor.linked', '1'); \(next)")
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        pageLoaded = false
        if arActive { stopAR() }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageLoaded = true
        if let key = pendingKey { applyKey(key) } else { openPending() }
    }

    // MARK: page → phone

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "ready":
            startAR()
        case "stop":
            stopAR()
            aimY = 0.5
        case "aim":
            if let y = body["y"] as? Double { aimY = CGFloat(min(max(y, 0.1), 0.9)) }
        case "trackImage":
            guard let id = body["id"] as? String, let text = body["url"] as? String,
                  let url = URL(string: text, relativeTo: webView.url)?.absoluteURL else { return }
            let width = (body["width"] as? Double) ?? 0.2
            URLSession.shared.dataTask(with: url) { [weak self] data, _, error in
                DispatchQueue.main.async {
                    guard let self else { return }
                    guard let data, let cg = UIImage(data: data)?.cgImage else {
                        self.sendError("Could not load the marker picture: \(error?.localizedDescription ?? "unreadable")")
                        return
                    }
                    let ref = ARReferenceImage(cg, orientation: .up, physicalWidth: CGFloat(width))
                    ref.name = id
                    self.markerImage = ref
                    if self.arActive { self.runSession(reset: false) }
                }
            }.resume()
        case "clearImage":
            markerImage = nil
            for a in arView.session.currentFrame?.anchors ?? [] where a is ARImageAnchor { arView.session.remove(anchor: a) }
            if arActive { runSession(reset: false) }
        case "openSafari":
            // Only the InRL site, in Safari (the person came from there).
            guard let text = body["url"] as? String, let url = URL(string: text),
                  url.scheme == "https", url.host == webView.url?.host else { return }
            UIApplication.shared.open(url)
        case "anchor":
            guard let m = body["m"] as? [Double], m.count == 16 else { return }
            if let old = sceneAnchor { arView.session.remove(anchor: old) }
            let anchor = ARAnchor(name: "scene", transform: matrix(from: m))
            arView.session.add(anchor: anchor)
            sceneAnchor = anchor
        case "clearAnchor":
            if let old = sceneAnchor { arView.session.remove(anchor: old) }
            sceneAnchor = nil
        case "raycast":
            guard let id = body["id"] as? Int, let x = body["x"] as? Double, let y = body["y"] as? Double else { return }
            let hit = floorHit(at: CGPoint(x: x, y: y)).map(list) ?? "null"
            webView.evaluateJavaScript("window.__inrlNative && __inrlNative.raycastResult(\(id), \(hit))")
        case "haptic":
            haptics.impactOccurred()
        case "reset":
            runSession(reset: true)
        case "paste":
            use(UIPasteboard.general.string ?? "")
        default:
            break
        }
    }

    // MARK: phone → page, every camera frame

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        // Skip a frame rather than queue them up when the page is busy. Waiting for each
        // reply before sending the next halved the rate (31/s on the iPhone 13).
        guard arActive, inFlight < 3 else { return }
        let size = webView.bounds.size
        guard size.width > 0 else { return }

        let proj = frame.camera.projectionMatrix(for: .portrait, viewportSize: size, zNear: 0.01, zFar: 100)
        // camera.transform is for the sensor's landscape orientation; the screen is portrait.
        let cam = frame.camera.viewMatrix(for: .portrait).inverse
        let hit = floorHit(at: CGPoint(x: size.width / 2, y: size.height * aimY))
        let anchor = sceneAnchor.flatMap { a in frame.anchors.first { $0.identifier == a.identifier } }
        let light = frame.lightEstimate.map { String(format: "%.0f", $0.ambientIntensity) } ?? "null"
        let planes = frame.anchors.filter { $0 is ARPlaneAnchor }.count
        var image = "null"
        if let name = markerImage?.name,
           let a = frame.anchors.compactMap({ $0 as? ARImageAnchor }).first(where: { $0.referenceImage.name == name }) {
            let w = Float(a.referenceImage.physicalSize.width) * Float(a.estimatedScaleFactor)
            image = "{id:\(jsString(name)),m:\(list(a.transform)),w:\(String(format: "%.4f", w)),tracked:\(a.isTracked)}"
        }
        let sent = Date().timeIntervalSince1970 * 1000

        let js = "window.__inrlNative && __inrlNative.frame({cam:\(list(cam)),proj:\(list(proj)),"
            + "hit:\(hit.map(list) ?? "null"),anchor:\(anchor.map { list($0.transform) } ?? "null"),"
            + "image:\(image),track:'\(trackingText(frame.camera.trackingState))',planes:\(planes),light:\(light),lowPower:\(ProcessInfo.processInfo.isLowPowerModeEnabled),sent:\(String(format: "%.1f", sent))})"
        inFlight += 1
        webView.evaluateJavaScript(js) { [weak self] _, _ in self?.inFlight -= 1 }
        readQr(frame)
    }

    /// Looks for QR codes in the camera picture, a few times a second, off the main thread.
    private func readQr(_ frame: ARFrame) {
        guard !qrBusy, frame.timestamp - lastQr > 0.25 else { return }
        qrBusy = true
        lastQr = frame.timestamp
        let buffer = frame.capturedImage
        qrQueue.async { [weak self] in
            let request = VNDetectBarcodesRequest()
            request.symbologies = [.qr]
            // The sensor is landscape; the phone is held upright.
            try? VNImageRequestHandler(cvPixelBuffer: buffer, orientation: .right).perform([request])
            let texts = (request.results ?? []).compactMap { $0.payloadStringValue }
            DispatchQueue.main.async {
                guard let self else { return }
                self.qrBusy = false
                guard self.arActive else { return }
                for t in texts {
                    self.webView.evaluateJavaScript("window.__inrlNative && __inrlNative.qr && __inrlNative.qr(\(self.jsString(t)))")
                }
            }
        }
    }

    private func sendError(_ text: String) {
        webView.evaluateJavaScript("window.__inrlNative && __inrlNative.error(\(jsString(text)))")
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        let text = error.localizedDescription.replacingOccurrences(of: "'", with: " ")
        webView.evaluateJavaScript("window.__inrlNative && __inrlNative.error('\(text)')")
    }

    // MARK: helpers

    /// The nearest horizontal surface under a screen point, in world space. Both found planes and
    /// ARKit's estimate are asked and the closest wins: a floor plane often reaches under a table,
    /// and taking it first put the aim mark on the floor seen "through" the table.
    private func floorHit(at point: CGPoint) -> simd_float4x4? {
        guard let cam = arView.session.currentFrame?.camera.transform.columns.3 else { return nil }
        var best: (d: Float, m: simd_float4x4)?
        for target in [ARRaycastQuery.Target.existingPlaneGeometry, .estimatedPlane] {
            guard let q = arView.raycastQuery(from: point, allowing: target, alignment: .horizontal) else { continue }
            for r in arView.session.raycast(q) {
                let p = r.worldTransform.columns.3
                let d = simd_distance(SIMD3(p.x, p.y, p.z), SIMD3(cam.x, cam.y, cam.z))
                if best == nil || d < best!.d - 0.02 { best = (d, r.worldTransform) }
            }
        }
        return best?.m
    }

    private func trackingText(_ state: ARCamera.TrackingState) -> String {
        switch state {
        case .normal: return "normal"
        case .notAvailable: return "unavailable"
        case .limited(.initializing): return "initializing"
        case .limited(.excessiveMotion): return "moving too fast"
        case .limited(.insufficientFeatures): return "not enough detail"
        case .limited(.relocalizing): return "relocalizing"
        case .limited: return "limited"
        }
    }

    private func list(_ m: simd_float4x4) -> String {
        let c = [m.columns.0, m.columns.1, m.columns.2, m.columns.3]
        return "[" + c.flatMap { [$0.x, $0.y, $0.z, $0.w] }.map { String(format: "%.5f", $0) }.joined(separator: ",") + "]"
    }

    private func matrix(from m: [Double]) -> simd_float4x4 {
        let f = m.map(Float.init)
        return simd_float4x4(
            SIMD4(f[0], f[1], f[2], f[3]), SIMD4(f[4], f[5], f[6], f[7]),
            SIMD4(f[8], f[9], f[10], f[11]), SIMD4(f[12], f[13], f[14], f[15]))
    }
}
