# Product vision

## In one sentence

InRL lets anyone make a small 3D scene on their phone and attach it to their
personal marker, so that pointing a camera at the marker (on a T-shirt, a
poster, a sticker, a screen) brings the scene to life in the real world.
Tagline from the onboarding: **"Online to Offline"**.

## Core loop

**Create → publish → attach to a marker → someone scans it in real life.**

1. **Create** in **InStudio**, the editor: up to **6 objects** per scene (to be replaced by a scene budget, decision 2026-10-08): 3D objects, 3D text, photos/videos/GIFs (on a 3D screen, floating, or flat on the marker), plus a background colour and music.
2. **Publish** the post: caption, song, "Attach to a Marker", "Published Successfully".
3. **Markers**: every free account gets one: a QR code inside artwork. The QR code says *whose* marker it is; the artwork is what the AR tracker follows. A marker shows the post its owner picked ("Edit your Marker"), and can be saved or printed (merch, stickers, posters).
4. **Scan**: the in-app scan button (centre of the nav bar) opens the camera; a marker shows its scene in AR. Because a QR code is a link, people without the app can scan it with their normal camera and land in the web app.

## Viewing modes (top switch on every post)

- **INART**: the post as a flat image/video in the feed, with likes, comments, share and the song.
- **IN3D**: the scene in 3D, orbited with gestures (one finger rotate, pinch zoom, two fingers pan, double-tap reset).
- **INRL**: the camera. On a marker: the scene appears on it. Without a marker: place it on a surface (Android first; iPhone browsers lack this, see decisions). A carousel switches between posts.

**Flat vs upright markers:** on a table the scene stands on the marker; on a wall, screen or T-shirt it stands upright, centred in front of the print.

## Social layer

Home feed (For You / Following), Discover search grid, profiles (Objects and
Marker tabs; Follow, Message), comments, likes, notifications. Bottom nav:
Home, Search, Scan (centre), Notifications, Profile.

## Content creation (the creative tools)

From the Unity-era product and the art direction deck:

- **3D objects** in many styles. Three starter worlds show the direction: Streetwear/Techwear (chrome + glass), Bubblegum Pop (clay, inflated), Designers (soft tech, custom-texture objects). They are examples, not limits: styles are an open, growing list and can be mixed. See [art direction](../design/art-direction.md).
- **AI 3D creation** (replaces Sketchfab): create objects from a description or a photo, in any style (the worlds are presets, free description too).
- **3D text** in many styles, starting with chrome, inflated balloon and collage cut-outs; materials and colours mixable.
- **3D screens**: a set of screen types (TV, phone, tablet, frame, billboard…) for photos, videos and GIFs.
- **GIFs** via GIPHY.
- **Characters / avatars**: Ready Player Me is gone; direction is AI-created rigged characters and a customizable blank designer toy.
- **Music** (licensing to be solved later) and **YouTube** (later, as an overlaid player).

## Who it's for

Creators and fans in street culture, fashion and toys: people who want their
merch, art or message to "come alive". Brands are a natural extension (the
older prototype grew into an AR merch shop), set aside for now.

## The founding idea: scenes left in places

InRL started as dropping content at a place, visible only in AR. A scene is
attached to GPS coordinates; private posts are seen only by the people
tagged, public posts by anyone but for a limited time. Built long after the
core (see the roadmap's "Later"); markers and the feed come first.
