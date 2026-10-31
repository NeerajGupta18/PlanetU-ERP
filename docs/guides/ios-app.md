# Run PlanetU on your own iPhone

This is for Neeraj. It puts the PlanetU app on your own iPhone for free, using your Mac. No payment and no Apple Developer membership. The app project is in the `ios-app` folder of the repo.

The app opens the live site, the same way the Android app does. So when the site is updated, the app shows the new version by itself. You only rebuild when the app itself expires (see step 8).

## What you need once

1. A Mac with about 40 GB free.
2. Xcode, free from the Mac App Store. It is a large download.
3. Your normal Apple ID. No paid account.
4. Your iPhone and its cable.

After Xcode has installed, open Terminal and run these two lines. They ask for your Mac password.

    sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
    sudo xcodebuild -license accept

You do not need CocoaPods. The project uses Swift Package Manager, which comes with Xcode.

## Step by step

### 1. Prepare the project

In Terminal, from the repo folder:

    git pull
    cd ios-app
    npm install
    npx cap sync ios
    npx cap open ios

Xcode opens. The first time, it downloads Capacitor for a minute or two. Wait until the bar at the top of Xcode says Ready.

### 2. Choose your Apple ID under Signing

1. In the left column click the blue **App** icon at the very top.
2. Under Targets click **App**, then open the **Signing & Capabilities** tab.
3. Tick **Automatically manage signing**.
4. Under **Team** choose **Add an Account**, sign in with your Apple ID, then choose **your name (Personal Team)**.

If Xcode says the app id `app.planetu.erp` cannot be registered, change **Bundle Identifier** to something of your own, for example `app.planetu.erp.neeraj`.

### 3. Plug in the iPhone

Connect the cable. Unlock the phone. Tap **Trust** on the phone if it asks, and enter the phone passcode. At the top of Xcode, choose your iPhone from the device list.

### 4. Turn on Developer Mode on the phone

On the iPhone: **Settings, Privacy & Security, Developer Mode**, turn it on, and restart when asked. After the restart, tap **Turn On** and enter the passcode.

If Developer Mode is not in the list, press Run once in step 5. It appears after that.

### 5. Press Run

Press the **Run** button (the triangle) at the top left of Xcode. The first build takes a few minutes.

### 6. Trust the developer profile

The first time, the phone refuses to open the app. That is normal. On the iPhone: **Settings, General, VPN & Device Management**, tap your Apple ID, tap **Trust**.

### 7. Open the app

Press Run again, or tap the PlanetU icon on the phone. Sign in as usual. On the free plan the live site can take up to a minute to wake up.

### 8. When it expires after 7 days

With a free Apple ID the app stops opening after 7 days. This is Apple's rule. Nothing is lost, because everything is on the server. To renew it, plug in the phone, run `npx cap open ios` from the `ios-app` folder, and press Run.

## Things to watch

- **Do not commit your signing choice.** Choosing your team makes Xcode save your team id in the project file. Before you commit anything, run `git checkout ios-app/ios/App/App.xcodeproj/project.pbxproj` to undo that. A test fails if a team id reaches the repo.
- **"Could not reach the server"** means no internet, or the live site is down. Check the site in Safari, then open the app again.
- **Camera for QR check-in.** The phone asks once. If you said no: **Settings, PlanetU Campus ERP, Camera**.
- **Long name.** The home screen may shorten "PlanetU Campus ERP". That is normal.

## Giving the app to other people

Other people cannot install the app this way. To send it to clients you need the paid Apple Developer Program, about 99 USD a year, and then TestFlight or the App Store. There is no free way around this, and we do not try one.

Until then, clients on iPhone use **Add to Home Screen** in Safari. It is free, takes a few seconds, does not expire, and gives them the same PlanetU screens. The steps are on the `/install` page of the site.
