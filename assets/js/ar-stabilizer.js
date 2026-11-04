// AR overlay stabiliser for viewer.html — keeps the video glued to the shirt print.
//
// Ported from the INRL2 app (othercode/INRL2-main: src/ar/smoothing.ts, fusion.ts,
// gravity.ts, MarkerTracker.ts), where it was tuned on an iPhone ("best with both on by
// far, glitch gone"). Three parts, each switchable for comparison via the page URL:
//
//  1. Frame lock (?framelock=0 to disable). MindAR reads a camera frame, takes a moment
//     to find the print in it, then reports the pose; by then the page already shows newer
//     frames, so when the phone moves the video slides against the print. Each frame MindAR
//     reads is copied and shown only once its pose is applied: picture and overlay always
//     match. Trade-off: the camera picture refreshes at the tracking rate.
//  2. Gyroscope fusion (?gyro=0 to disable). The tracker reading changes both when the
//     phone turns and when it wobbles; a filter can't tell them apart. The motion sensor
//     measures the phone's turning directly, so each reading becomes "where the print is in
//     the room", is smoothed there (nothing to lag behind when the phone turns), and is
//     turned back with the phone's orientation at draw time. Holds through short tracking
//     losses (motion blur) for COAST_MS.
//  3. One Euro anti-jitter (speed-based): strong smoothing when still, cut-off rises with
//     real movement so the overlay keeps up. Used alone when there is no motion sensor.
//
// Not ported: INRL2's gravity lock and wall direction hold. They assume a print hanging
// still on a wall or lying on a table; a worn shirt moves and turns with its wearer.
//
// MindAR's own One Euro filter stays at its defaults (filterMinCF 0.001, filterBeta 1000,
// set in viewer.html) — INRL2 runs the same values under this layer.
(function () {
  'use strict';
  const THREE = window.AFRAME && window.AFRAME.THREE;
  if (!THREE) { console.warn('[INRL AR] ar-stabilizer: A-Frame not loaded'); return; }

  const params = new URLSearchParams(location.search);
  const STABILIZE_ON = params.get('stabilize') !== '0'; // ?stabilize=0: plain MindAR pose, for A/B
  const GYRO_ON = params.get('gyro') !== '0';
  const FRAME_LOCK_ON = params.get('framelock') !== '0';

  // ---------- One Euro pose smoother (smoothing.ts) ----------
  const MIN_CUTOFF = 0.9;  // Hz, when still: strong smoothing
  const BETA_MOVE = 7;     // extra Hz per marker width per second
  const BETA_TURN = 10;    // extra Hz per radian per second
  const D_CUTOFF = 1;      // Hz, for the speed estimate itself
  const RENDER_MS = 16;    // render frames ease towards the latest filtered pose (hides 30 Hz steps)
  const alpha = (cutoffHz, dt) => 1 / (1 + (1 / (2 * Math.PI * cutoffHz)) / dt);

  class PoseSmoother {
    constructor(opts = {}) {
      this.minCutoffTurn = opts.minCutoffTurn ?? MIN_CUTOFF;
      this.position = new THREE.Vector3();
      this.quaternion = new THREE.Quaternion();
      this.scale = new THREE.Vector3(1, 1, 1);
      this.fPos = new THREE.Vector3();
      this.fQuat = new THREE.Quaternion();
      this.vPos = new THREE.Vector3();
      this.vTurn = new THREE.Vector3();
      this.lastT = 0;
      this.initialised = false;
      this.raw = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: new THREE.Vector3() };
    }
    // New tracker reading. `snap` jumps straight to it (just found).
    setTarget(m, snap = false, timeMs = performance.now()) {
      const { pos, quat, scale } = this.raw;
      m.decompose(pos, quat, scale);
      this.scale.copy(scale);
      if (snap || !this.initialised) {
        this.fPos.copy(pos); this.fQuat.copy(quat);
        this.position.copy(pos); this.quaternion.copy(quat);
        this.vPos.set(0, 0, 0); this.vTurn.set(0, 0, 0);
        this.lastT = timeMs; this.initialised = true;
        return;
      }
      const dt = Math.min(Math.max((timeMs - this.lastT) / 1000, 1 / 240), 0.1);
      this.lastT = timeMs;
      const size = this.scale.x || 1;
      // Signed velocities, so back-and-forth wobble averages out to "not moving".
      const dPos = pos.clone().sub(this.fPos).divideScalar(size * dt);
      const dq = this.fQuat.clone().invert().multiply(quat);
      if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
      const angle = 2 * Math.acos(Math.min(1, dq.w));
      const s = Math.sqrt(Math.max(1e-12, 1 - dq.w * dq.w));
      const dTurn = new THREE.Vector3(dq.x / s, dq.y / s, dq.z / s).multiplyScalar(angle / dt);
      const ad = alpha(D_CUTOFF, dt);
      this.vPos.lerp(dPos, ad);
      this.vTurn.lerp(dTurn, ad);
      const speedUp = Math.max(BETA_MOVE * this.vPos.length(), BETA_TURN * this.vTurn.length());
      this.fPos.lerp(pos, alpha(MIN_CUTOFF + speedUp, dt));
      this.fQuat.slerp(quat, alpha(this.minCutoffTurn + speedUp, dt));
    }
    update(dtMs, out) {
      if (!this.initialised) return out;
      const k = 1 - Math.exp(-Math.min(dtMs, 100) / RENDER_MS);
      this.position.lerp(this.fPos, k);
      this.quaternion.slerp(this.fQuat, k);
      return out.compose(this.position, this.quaternion, this.scale);
    }
  }

  // ---------- phone orientation history (fusion.ts / gravity.ts) ----------
  class AttitudeHistory {
    constructor() { this.samples = []; }
    push(t, q) {
      const last = this.samples[this.samples.length - 1];
      if (last && t <= last.t) return;
      const qq = q.clone(); // same hemisphere, so interpolation takes the short way
      if (last && last.q.dot(qq) < 0) qq.set(-qq.x, -qq.y, -qq.z, -qq.w);
      this.samples.push({ t, q: qq });
      while (this.samples.length > 2 && this.samples[0].t < t - 1000) this.samples.shift();
    }
    // Camera-to-room rotation at time t (performance.now clock). False if unknown.
    at(t, out) {
      const s = this.samples;
      if (!s.length) return false;
      if (t <= s[0].t) return !!out.copy(s[0].q);
      const last = s[s.length - 1];
      if (t >= last.t) {
        // A little ahead of the last sample (sensor ~60 Hz): continue its turn, briefly.
        const prev = s[s.length - 2];
        if (!prev || t - last.t > 100) return !!out.copy(last.q);
        const k = (t - last.t) / (last.t - prev.t);
        const step = prev.q.clone().invert().multiply(last.q);
        const ahead = new THREE.Quaternion().slerp(step, Math.min(k, 2));
        return !!out.copy(last.q).multiply(ahead);
      }
      let i = s.length - 1;
      while (i > 0 && s[i - 1].t > t) i--;
      const a = s[i - 1], b = s[i];
      return !!out.copy(a.q).slerp(b.q, (t - a.t) / (b.t - a.t));
    }
  }

  // Device orientation angles (degrees, W3C) → camera-to-room rotation for a screen at `screenAngle`.
  function cameraAttitude(a, b, g, screenAngle, out) {
    const D = Math.PI / 180;
    out.setFromEuler(new THREE.Euler(b * D, g * D, a * D, 'ZXY')); // W3C Rz(alpha)·Rx(beta)·Ry(gamma)
    if (screenAngle) out.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -screenAngle * D));
    return out;
  }

  const motion = {
    history: new AttitudeHistory(),
    status: 'DeviceOrientationEvent' in window ? 'pending' : 'unavailable',
    rate: 0, count: 0, since: 0,
    q: new THREE.Quaternion(),
    listening: false,
    onOrientation(e) {
      if (e.alpha === null || e.beta === null || e.gamma === null) return;
      const screenAngle = (screen.orientation && screen.orientation.angle) || 0;
      motion.history.push(e.timeStamp, cameraAttitude(e.alpha, e.beta, e.gamma, screenAngle, motion.q));
      motion.count++;
      if (e.timeStamp - motion.since >= 1000) {
        motion.rate = Math.round((motion.count * 1000) / (e.timeStamp - motion.since));
        motion.count = 0; motion.since = e.timeStamp;
      }
    },
  };

  // iOS only grants motion access after asking, and the ask must start inside a tap:
  // call this synchronously at the top of the tap handler (before any await).
  function requestMotion() {
    if (!STABILIZE_ON || !GYRO_ON || motion.status === 'unavailable' || motion.listening) return;
    const ask = window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission;
    const granted = ask ? ask.call(DeviceOrientationEvent).then((r) => r === 'granted', () => false) : Promise.resolve(true);
    granted.then((ok) => {
      motion.status = ok ? 'granted' : 'denied';
      if (ok && !motion.listening) { window.addEventListener('deviceorientation', motion.onOrientation); motion.listening = true; }
    });
  }

  // ---------- gyroscope fusion (fusion.ts, without gravity lock / wall hold) ----------
  const COAST_MS = 600;
  const ROOM_TURN_CUTOFF = 0.3; // Hz: the print's own turning, smoothed hard (the filter speeds up when it really turns)

  class PoseFusion {
    constructor(attitude) {
      this.attitude = attitude;
      this.smoother = new PoseSmoother({ minCutoffTurn: ROOM_TURN_CUTOFF });
      this.q = new THREE.Quaternion();
      this.rot = new THREE.Matrix4();
      this.room = new THREE.Matrix4();
      this.hasRoom = false;
      this.lostAt = null;
    }
    // A fresh reading m (print in camera space) from a frame read at t. False if no gyro data yet.
    reading(m, t, snap) {
      if (!this.attitude.at(t, this.q)) return false;
      this.room.makeRotationFromQuaternion(this.q).multiply(m);
      this.smoother.setTarget(this.room, snap || !this.hasRoom, t);
      this.hasRoom = true;
      this.lostAt = null;
      return true;
    }
    lost(t) { if (this.lostAt === null) this.lostAt = t; }
    get active() { return this.hasRoom; }
    showing(t) { return this.hasRoom && (this.lostAt === null || t - this.lostAt < COAST_MS); }
    // The print in camera space for a picture of the moment t.
    view(t, dtMs, out) {
      if (!this.hasRoom || !this.attitude.at(t, this.q)) return false;
      this.smoother.update(dtMs, this.room);
      this.rot.makeRotationFromQuaternion(this.q).invert();
      out.multiplyMatrices(this.rot, this.room);
      return true;
    }
  }

  // ---------- glue onto MindAR's A-Frame system ----------
  const state = { installed: false, gyroActive: false, trackFps: 0, frameLock: false, gyro: GYRO_ON };
  // The hooks for the current MindAR controller. viewer.html's softReinit (rotation) stops
  // and restarts MindAR — a new controller and camera <video> — so install() runs again on
  // the next arReady and must replace, not stack on, the previous hooks and frame canvases.
  let current = null;

  // Call from the scene's `arReady` listener: MindAR has its controller and is about to
  // start processVideo, so the input hook is in place before the first tracked frame.
  function install({ scene, targetEl }) {
    if (!STABILIZE_ON) return;
    const sys = scene.systems && scene.systems['mindar-image-system'];
    const comp = targetEl.components && targetEl.components['mindar-image-target'];
    const ctrl = sys && sys.controller;
    const video = sys && sys.video;
    if (!ctrl || !comp || !video) { console.warn('[INRL AR] stabiliser not installed: MindAR not ready'); return; }
    if (current && current.ctrl === ctrl) return;
    if (current) current.teardown();
    state.installed = true;

    const obj = targetEl.object3D;
    obj.matrixAutoUpdate = false;
    obj.matrix = new THREE.Matrix4();
    const smoother = new PoseSmoother();
    const fusion = GYRO_ON && motion.status !== 'unavailable' ? new PoseFusion(motion.history) : null;
    let tracked = false;   // the tracker currently reports the print (drives found/lost events)
    let readTime = 0;      // when MindAR read the frame being processed (ms)
    let processing = true;

    // Frame lock: two canvases over the live video (which tracking still reads); the front
    // one shows the last tracked frame, the back one receives the frame being tracked.
    const frames = [];
    const frameTimes = [0, 0];
    let front = 0, captured = false, lastBox = '';
    if (FRAME_LOCK_ON) {
      for (let i = 0; i < 2; i++) {
        const c = document.createElement('canvas');
        c.width = video.videoWidth; c.height = video.videoHeight;
        c.style.cssText = `position:absolute;z-index:-1;visibility:${i === 0 ? 'visible' : 'hidden'}`;
        video.parentNode.insertBefore(c, video.nextSibling);
        frames.push(c);
      }
      state.frameLock = true;
    }
    const syncFrameBox = () => { // follow MindAR's _resize placement of the live video
      const box = `${video.style.top}|${video.style.left}|${video.style.width}|${video.style.height}`;
      if (box === lastBox) return;
      lastBox = box;
      for (const c of frames) Object.assign(c.style, { top: video.style.top, left: video.style.left, width: video.style.width, height: video.style.height });
    };

    const loader = ctrl.inputLoader;
    const load = loader.loadInput.bind(loader);
    loader.loadInput = (input) => {
      if (processing) {
        readTime = performance.now();
        if (frames.length) {
          const back = frames[1 - front];
          back.getContext('2d').drawImage(input, 0, 0, back.width, back.height);
          frameTimes[1 - front] = readTime;
          captured = true;
        }
      }
      return load(input);
    };

    let tracks = 0, trackSince = performance.now();
    const presentFrame = () => {
      tracks++;
      const t = performance.now();
      if (t - trackSince >= 1000) { state.trackFps = Math.round((tracks * 1000) / (t - trackSince)); tracks = 0; trackSince = t; }
      if (!captured) return;
      captured = false;
      front = 1 - front;
      frames[front].style.visibility = 'visible';
      frames[1 - front].style.visibility = 'hidden';
    };
    const origOnUpdate = ctrl.onUpdate;
    ctrl.onUpdate = (data) => {
      origOnUpdate && origOnUpdate(data);
      if (data.type === 'processDone') presentFrame();
    };

    // Replaces mindar-image-target's updateWorldMatrix: same events, but the pose goes
    // through fusion / the smoother instead of straight onto the entity.
    comp.updateWorldMatrix = function (worldMatrix) {
      this.el.emit('targetUpdate');
      const found = worldMatrix !== null;
      if (!tracked && found) this.el.emit('targetFound');
      else if (tracked && !found) this.el.emit('targetLost');
      const now = performance.now();
      if (found) {
        const m = new THREE.Matrix4();
        m.elements = worldMatrix;
        m.multiply(this.postMatrix);
        // MindAR repeats its last pose for a few frames after it stops finding the print;
        // with the gyroscope those stale poses are wrong (the phone has turned since).
        const ts = ctrl.trackingStates && ctrl.trackingStates[this.data.targetIndex || 0];
        const fresh = !ts || ts.isTracking !== false;
        if (fusion && !fresh) fusion.lost(now);
        else if (!(fusion && fusion.reading(m, readTime || now, !tracked))) smoother.setTarget(m, !tracked);
      } else if (fusion) {
        fusion.lost(now);
      }
      tracked = found;
      obj.visible = found;
    };

    let lastTick = performance.now();
    const tick = () => {
        const now = performance.now();
        const dt = now - lastTick;
        lastTick = now;
        if (frames.length) syncFrameBox();
        // With the gyroscope: the pose for the picture on screen (the locked frame's moment).
        const fusionTime = frames.length ? frameTimes[front] : now;
        state.gyroActive = !!(fusion && fusion.showing(now) && fusion.view(fusionTime, dt, obj.matrix));
        if (state.gyroActive) obj.visible = true;                 // tracking, or coasting through a short loss
        else if (fusion && fusion.active) obj.visible = false;    // lost for longer than the gyro can bridge
        else if (tracked) smoother.update(dt, obj.matrix);
        else obj.visible = false;
        obj.matrixWorldNeedsUpdate = true;
    };

    current = {
      ctrl,
      tick,
      teardown() {
        processing = false;
        for (const c of frames) c.remove();
        state.frameLock = false;
      },
    };
    if (!AFRAME.components['inrl-stabilizer']) {
      AFRAME.registerComponent('inrl-stabilizer', { tick() { if (current) current.tick(); } });
    }
    if (!targetEl.hasAttribute('inrl-stabilizer')) targetEl.setAttribute('inrl-stabilizer', '');
  }

  window.INRLStabilizer = { requestMotion, install, state, motion };
})();
