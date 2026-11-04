# InRL Floor (iPhone floor-placement test)

A thin native app: the whole InRL web app (live site) in a transparent web
view; when a page asks for it (a post's INRL, `/floor`), ARKit finds the
surface and tracks the phone underneath and the page draws the scene with
three.js. From Safari, a post's INRL → "Open in the InRL test app"
(`inrlfloor://open?path=…#<phone key>`) opens that post here, signed in. The bridge is described in
`FloorTest/FloorViewController.swift` and `src/floor/bridge.ts`. This is the
shape a future App Clip would take.

Build and install on Nico's iPhone (free Apple ID nico@wearenot.co, team RA4U4TWPVZ; the tessier.n@gmail.com free team hit its device limit):

```bash
brew install xcodegen             # once
cd ios && xcodegen generate
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer   # xcode-select points at the Command Line Tools
xcodebuild -project FloorTest.xcodeproj -scheme FloorTest -destination 'platform=iOS,name=iPhone' \
  -derivedDataPath ../.cache/ios-build -allowProvisioningUpdates build
xcrun devicectl device install app --device <id> ../.cache/ios-build/Build/Products/Debug-iphoneos/FloorTest.app
```

Free-account installs expire after 7 days (rebuild to renew). The first launch
needs Settings → General → VPN & Device Management → trust the developer.
In Safari, `/floor` offers "Open my scenes in InRL Floor", which hands the
phone's scene key to the app (`inrlfloor://link#<key>`).
