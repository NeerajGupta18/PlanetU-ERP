#!/usr/bin/env bash
# Puts the PlanetU name, icon, launch screen and permission wording on the iOS project (from ios-app/, on a Mac).
# The result is committed, so this only needs running again when the icon or the wording changes.
set -e
APP=ios/App/App
PLIST=$APP/Info.plist
PB=/usr/libexec/PlistBuddy
SRC=../client/public/icon-maskable-512.png

# Name and app id: `cap add` would do this, and it is skipped because of the template step in docs/guides/ios-app.md
sed -i '' 's/PRODUCT_BUNDLE_IDENTIFIER = [^;]*;/PRODUCT_BUNDLE_IDENTIFIER = app.planetu.erp;/' ios/App/App.xcodeproj/project.pbxproj
"$PB" -c 'Set :CFBundleDisplayName PlanetU Campus ERP' "$PLIST"

# set_key name value: adds or replaces a text entry
set_key() { "$PB" -c "Set :$1 $2" "$PLIST" 2>/dev/null || "$PB" -c "Add :$1 string $2" "$PLIST"; }
set_key NSCameraUsageDescription 'PlanetU uses the camera to scan the QR code when you check in to a class, and to take a photo of a document you choose to upload.'
set_key NSLocationWhenInUseUsageDescription 'PlanetU checks your location only when your teacher asks for it during a class check-in.'
# The ERP has one light look. Without this a phone in dark mode shows white status bar text on the white top bar.
set_key UIUserInterfaceStyle Light

# The icon: the 512 px logo with its safe margin, on white, with no transparency
sips -z 1024 1024 "$SRC" --out "$APP/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png" >/dev/null
# The launch screen: the logo in the middle of white
SPLASH=$APP/Assets.xcassets/Splash.imageset
sips --padToHeightWidth 2732 2732 --padColor FFFFFF "$SRC" --out "$SPLASH/splash-2732x2732.png" >/dev/null
cp "$SPLASH/splash-2732x2732.png" "$SPLASH/splash-2732x2732-1.png"
cp "$SPLASH/splash-2732x2732.png" "$SPLASH/splash-2732x2732-2.png"
echo "Name, icon, launch screen and permission wording set."
