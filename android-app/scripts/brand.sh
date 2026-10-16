#!/usr/bin/env bash
# Puts the PlanetU icon on the generated Android project (run after `npx cap add android`, from android-app/).
set -e
RES=android/app/src/main/res
SRC=../client/public/icon-maskable-512.png
IM=$(command -v magick || command -v convert)
size() { # folder legacy-size foreground-size
  for f in ic_launcher.png ic_launcher_round.png; do "$IM" "$SRC" -resize "${2}x${2}" "$RES/$1/$f"; done
  "$IM" "$SRC" -resize "${3}x${3}" "$RES/$1/ic_launcher_foreground.png"
}
size mipmap-mdpi 48 108
size mipmap-hdpi 72 162
size mipmap-xhdpi 96 216
size mipmap-xxhdpi 144 324
size mipmap-xxxhdpi 192 432
# The adaptive icon is the PlanetU logo on white
cat > "$RES/values/ic_launcher_background.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#FFFFFF</color>
</resources>
XML
echo "Icons set."

# The in-app attendance scanner needs the camera (and, if a teacher asks for it, the location)
MANIFEST=android/app/src/main/AndroidManifest.xml
add_perm() { grep -q "$1" "$MANIFEST" || sed -i "s#<application#$2\n    <application#" "$MANIFEST"; }
add_perm 'android.permission.CAMERA' '    <uses-permission android:name="android.permission.CAMERA" />'
add_perm 'android.permission.ACCESS_FINE_LOCATION' '    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />'
add_perm 'android.permission.ACCESS_COARSE_LOCATION' '    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />'
add_perm 'android.hardware.camera' '    <uses-feature android:name="android.hardware.camera" android:required="false" />'
echo "Camera and location permissions set."
