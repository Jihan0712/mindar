/* Getting a customer's video ready for their T-shirt, in the browser.
   Phones save .MOV (often HEVC, 20-40 MB for 15 s); the shirt plays an MP4 (H.264 + AAC) of up
   to 30 s that stays under 10 MB so a scan starts quickly. A file that already fits is uploaded
   as it is; anything else is converted, shrunk and trimmed here with Mediabunny (WebCodecs, the
   phone's own encoder), so nothing extra runs on our server.
   The decisions (plan, outputSize, videoBitrate, …) are pure functions the tests share; inspect()
   and convert() load the library on first use. */
(function (root) {
  'use strict';

  var LIMITS = {
    maxBytes: 10 * 1024 * 1024, // what the shirt plays: small enough to start quickly on a scan
    maxSeconds: 30,
    longSide: 1280,             // 720p: plenty for a video on a T-shirt
    audioBps: 96000,
    maxVideoBps: 2500000,
    minVideoBps: 500000,
    fill: 0.88,                 // aim under the limit: encoders overshoot a little
    maxFps: 30,
  };

  function ext(name) { var m = /\.([a-z0-9]+)$/i.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; }

  // info: { name, type, size, duration, videoCodec, audioCodec, width, height }
  // → { action: 'keep' | 'convert', reasons: [...], trim: bool }
  function plan(info) {
    var reasons = [];
    var isMp4 = /mp4/i.test(info.type || '') || ext(info.name) === 'mp4' || ext(info.name) === 'm4v';
    if (!isMp4) reasons.push('format');
    if (info.videoCodec && info.videoCodec !== 'avc') reasons.push('codec');
    if (info.audioCodec && info.audioCodec !== 'aac') reasons.push('audio');
    if (info.size > LIMITS.maxBytes) reasons.push('size');
    var trim = info.duration > LIMITS.maxSeconds + 0.05;
    if (trim) reasons.push('length');
    var big = Math.max(info.width || 0, info.height || 0) > LIMITS.longSide * 1.5;
    if (big && reasons.length) reasons.push('resolution');
    return { action: reasons.length ? 'convert' : 'keep', reasons: reasons, trim: trim };
  }

  function even(n) { return Math.max(2, Math.round(n / 2) * 2); }
  // The frame size to encode: the video's shape, long side at most LIMITS.longSide, even numbers.
  function outputSize(w, h) {
    if (!w || !h) return null;
    var s = Math.min(1, LIMITS.longSide / Math.max(w, h));
    return { width: even(w * s), height: even(h * s) };
  }

  // Video bitrate that keeps `seconds` of video (plus audio) under the size limit. Each retry
  // (attempt 1, 2, …) aims lower in case the encoder overshot.
  function videoBitrate(seconds, attempt) {
    var budget = LIMITS.maxBytes * 8 * LIMITS.fill / Math.max(1, seconds) - LIMITS.audioBps;
    var bps = Math.min(LIMITS.maxVideoBps, budget) * Math.pow(0.7, attempt || 0);
    return Math.round(Math.max(LIMITS.minVideoBps, bps));
  }

  // 60 fps phone video is halved to 30; slower video keeps its own rate.
  function frameRate(fps) { return fps && fps > LIMITS.maxFps + 1 ? LIMITS.maxFps : undefined; }

  // Which part of a long video is used: `start` clamped so a full 30 s window fits.
  function trimWindow(duration, start) {
    var len = Math.min(LIMITS.maxSeconds, duration);
    var s = Math.max(0, Math.min(Number(start) || 0, duration - len));
    return { start: s, end: s + len };
  }

  function outName(name) { return (String(name || 'video').replace(/\.[^.]+$/, '') || 'video') + '.mp4'; }

  function clock(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }

  /* ---------- browser only ---------- */
  var LIB = '/ecommerce/js/vendor/mediabunny/mediabunny.min.mjs';
  var AAC = '/ecommerce/js/vendor/mediabunny/mediabunny-aac-encoder.min.mjs';
  var libP = null;
  // The AAC extension imports "mediabunny" by name: the page's import map points it at LIB, so
  // both share one copy of the library.
  function lib() { return libP || (libP = import(LIB)); }

  // Reads what's in the file. { ok, duration, videoCodec, audioCodec, width, height, fps,
  // canDecode } or { ok: false, why: 'no-video' | 'unreadable' }.
  async function inspect(file) {
    var MB = await lib();
    var input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
    try {
      var v = await input.getPrimaryVideoTrack();
      if (!v) return { ok: false, why: 'no-video' };
      var a = await input.getPrimaryAudioTrack();
      var stats = await v.computePacketStats(90).catch(function () { return null; });
      return {
        ok: true,
        duration: await input.computeDuration(),
        videoCodec: await v.getCodec(),
        audioCodec: a ? await a.getCodec() : null,
        width: await v.getDisplayWidth(),
        height: await v.getDisplayHeight(),
        fps: stats ? stats.averagePacketRate : null,
        canDecode: await v.canDecode(),
      };
    } catch (e) {
      return { ok: false, why: 'unreadable' };
    } finally {
      input.dispose();
    }
  }

  // Can this browser make an H.264 MP4 at all? (Every current Safari, Chrome, Edge and Firefox can.)
  async function canConvert(size) {
    if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') return false;
    var MB = await lib();
    return MB.canEncodeVideo('avc', size ? { width: size.width, height: size.height } : undefined);
  }

  // Converts `file` (with `info` from inspect) to the MP4 the shirt plays.
  // opts: { start, onProgress(0..1), onConversion(conversion) for cancelling }
  // → { blob, name, bytes, seconds, width, height, audio: bool }
  async function convert(file, info, opts) {
    opts = opts || {};
    var MB = await lib();
    var size = outputSize(info.width, info.height);
    if (!(await canConvert(size))) throw new Error('This browser can’t convert videos. Open this page in Safari or Chrome, or export the video as an MP4 under 10 MB.');
    if (info.audioCodec && !(await MB.canEncodeAudio('aac'))) {
      var A = await import(AAC);
      A.registerAacEncoder();
    }
    var win = trimWindow(info.duration, opts.start);
    var seconds = win.end - win.start;
    for (var attempt = 0; attempt < 3; attempt++) {
      var input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
      var output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new MB.BufferTarget() });
      try {
        var conversion = await MB.Conversion.init({
          input: input, output: output, tracks: 'primary', showWarnings: false,
          trim: win.start > 0 || win.end < info.duration ? { start: win.start, end: win.end } : undefined,
          video: {
            codec: 'avc', width: size && size.width, height: size && size.height, fit: 'cover',
            frameRate: frameRate(info.fps),
            quality: new MB.Quality({ bitrate: videoBitrate(seconds, attempt), bitrateMode: attempt ? 'constant' : 'variable' }),
            allowTransformationMetadata: false, // bake rotation into the frames: the AR texture ignores it
            keyFrameInterval: 2,
            forceTranscode: attempt > 0,
          },
          audio: { codec: 'aac', quality: new MB.Quality({ bitrate: LIMITS.audioBps }), numberOfChannels: 2, forceTranscode: attempt > 0 },
        });
        var keptVideo = conversion.utilizedTracks.some(function (t) { return t.type === 'video'; });
        if (!conversion.isValid || !keptVideo) throw new Error('This video can’t be converted in this browser (its format isn’t supported here). Try Safari or Chrome, or export it as an MP4.');
        var keptAudio = conversion.utilizedTracks.some(function (t) { return t.type === 'audio'; });
        if (opts.onConversion) opts.onConversion(conversion);
        conversion.onProgress = function (p) { if (opts.onProgress) opts.onProgress(Math.min(1, (attempt + p) / (attempt + 1))); };
        await conversion.execute();
        var blob = new Blob([output.target.buffer], { type: 'video/mp4' });
        if (blob.size <= LIMITS.maxBytes || attempt === 2) {
          if (blob.size > LIMITS.maxBytes) throw new Error('The converted video is still over 10 MB. Try a shorter part of it.');
          return { blob: blob, name: outName(file.name), bytes: blob.size, seconds: seconds, width: size && size.width, height: size && size.height, audio: keptAudio };
        }
      } catch (e) {
        if (e && e.name === 'ConversionCanceledError') { var c = new Error('cancelled'); c.cancelled = true; throw c; }
        throw e;
      } finally {
        input.dispose();
      }
    }
  }

  var api = { LIMITS: LIMITS, plan: plan, outputSize: outputSize, videoBitrate: videoBitrate, frameRate: frameRate, trimWindow: trimWindow, outName: outName, clock: clock, inspect: inspect, canConvert: canConvert, convert: convert };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VideoPrep = api;
})(this);
