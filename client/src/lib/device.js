/** A random id kept on this phone, so the teacher can be told when one phone is used to mark several students. */
export function deviceId() {
  try {
    let id = localStorage.getItem('planetu.device');
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) || `d-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem('planetu.device', id);
    }
    return id;
  } catch { return undefined; }
}

/** The phone's position, or null if it was not allowed or took too long. */
export function getPosition(timeout = 8000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 15000 },
    );
  });
}
