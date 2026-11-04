import SwiftUI

/*
 * InRL floor-placement test. A thin native shell: ARKit finds the floor and
 * tracks the phone; the InRL web page (/floor), shown in a transparent web
 * view on top of the camera, draws the scene with three.js. Each camera
 * frame, the phone's position and the camera lens are sent to the page, so
 * the page's 3D camera matches the real one. This is the shape an App Clip
 * would take: web updates need no Apple review.
 */
@main
struct FloorTestApp: App {
    var body: some Scene {
        WindowGroup {
            FloorView()
                .ignoresSafeArea()
                .statusBarHidden()
                .onOpenURL { url in
                    // Kept until the screen picks it up, in case it arrives during start-up.
                    PendingLink.url = url
                    NotificationCenter.default.post(name: .inrlOpenURL, object: url)
                }
        }
    }
}

enum PendingLink {
    static var url: URL?
}

extension Notification.Name {
    static let inrlOpenURL = Notification.Name("inrlOpenURL")
}

struct FloorView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> FloorViewController { FloorViewController() }
    func updateUIViewController(_ vc: FloorViewController, context: Context) {}
}
