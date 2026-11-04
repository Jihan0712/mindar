# Designing markers that track

The AR layer recognises a marker by its artwork; the QR code inside it only
says whose marker it is. These rules come from how MindAR, the tracker, sees
an image, and from the earlier INRL prototype's experience printing markers.

1. **Contrast in brightness, not colour.** The tracker turns the image grey
   before doing anything. Two colours of equal brightness look identical to
   it. Check a design by desaturating it.
2. **Lots of irregular detail.** It locks onto corners: places where
   brightness changes sharply in more than one direction. Busy, hand-drawn,
   collage-like artwork tracks well; big flat areas, smooth gradients and a
   lone logo do not.
3. **Never a repeating pattern.** Repeats make different parts of the marker
   look alike, so the tracker cannot tell where it is.
4. **Detail all the way to the edges.** Empty margins waste tracking area.
5. **Matte, flat, and big enough.** Gloss reflects light; folds bend the
   picture. About 15 cm across works from 20 to 60 cm away.

`npm run marker` regenerates the test marker and refuses one with fewer than
250 "matching points", the threshold below which detection becomes unreliable
in print. The current test marker has about 4,100.
