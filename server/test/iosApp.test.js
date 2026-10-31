/** The iOS app project: same app as Android, the permissions it needs, and nothing it must not have - run with `npm test`. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(root + p, 'utf8');
const ios = JSON.parse(read('ios-app/capacitor.config.json'));
const android = JSON.parse(read('android-app/capacitor.config.json'));
const plist = read('ios-app/ios/App/App/Info.plist');
const project = read('ios-app/ios/App/App.xcodeproj/project.pbxproj');

describe('iOS app project', () => {
  it('is the same app as Android, loading the same live site', () => {
    assert.equal(ios.appId, android.appId);
    assert.equal(ios.appName, 'PlanetU Campus ERP');
    assert.equal(ios.appendUserAgent, android.appendUserAgent);
    assert.equal(ios.server.url, android.server.url);
    assert.equal(ios.server.cleartext, false);
    assert.deepEqual(ios.server.allowNavigation, ['planetu-erp.onrender.com']);
  });
  it('carries the app id and name in the Xcode project', () => {
    const ids = [...project.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map((m) => m[1]);
    assert.ok(ids.length > 0);
    assert.ok(ids.every((id) => id === ios.appId), ids.join());
    assert.match(plist, /<key>CFBundleDisplayName<\/key>\s*<string>PlanetU Campus ERP<\/string>/);
  });
  it('explains the camera, for QR check-in', () => {
    assert.match(plist, /<key>NSCameraUsageDescription<\/key>\s*<string>[^<]*QR code[^<]*<\/string>/);
  });
  it('has no Face ID and no tracking', () => {
    assert.doesNotMatch(plist, /NSFaceIDUsageDescription|NSUserTrackingUsageDescription/);
  });
  it('holds no signing team or profile', () => {
    assert.doesNotMatch(project, /DEVELOPMENT_TEAM = \w+|PROVISIONING_PROFILE_SPECIFIER = \w+/);
  });
  it('has its icon, launch screen and offline page', () => {
    for (const f of ['ios-app/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', 'ios-app/ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png', 'ios-app/www/index.html']) {
      assert.ok(existsSync(root + f), f);
    }
  });
  it('tells git to leave signing files and build output out', () => {
    const ignored = (p) => { try { execFileSync('git', ['check-ignore', '-q', p], { cwd: root }); return true; } catch { return false; } };
    for (const p of ['ios-app/ios/App/Pods/x', 'ios-app/ios/DerivedData/x', 'ios-app/ios/App/App.xcodeproj/xcuserdata/x', 'ios-app/ios/my.mobileprovision', 'ios-app/ios/my.p12', 'ios-app/node_modules/x']) {
      assert.ok(ignored(p), p);
    }
  });
});
