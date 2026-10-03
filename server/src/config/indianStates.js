/** Indian states and union territories with their GST state codes (the first two digits of a GSTIN). */
export const STATES = [
  ['Jammu and Kashmir', '01'], ['Himachal Pradesh', '02'], ['Punjab', '03'], ['Chandigarh', '04'], ['Uttarakhand', '05'], ['Haryana', '06'],
  ['Delhi', '07'], ['Rajasthan', '08'], ['Uttar Pradesh', '09'], ['Bihar', '10'], ['Sikkim', '11'], ['Arunachal Pradesh', '12'],
  ['Nagaland', '13'], ['Manipur', '14'], ['Mizoram', '15'], ['Tripura', '16'], ['Meghalaya', '17'], ['Assam', '18'], ['West Bengal', '19'],
  ['Jharkhand', '20'], ['Odisha', '21'], ['Chhattisgarh', '22'], ['Madhya Pradesh', '23'], ['Gujarat', '24'],
  ['Dadra and Nagar Haveli and Daman and Diu', '26'], ['Maharashtra', '27'], ['Karnataka', '29'], ['Goa', '30'], ['Lakshadweep', '31'],
  ['Kerala', '32'], ['Tamil Nadu', '33'], ['Puducherry', '34'], ['Andaman and Nicobar Islands', '35'], ['Telangana', '36'],
  ['Andhra Pradesh', '37'], ['Ladakh', '38'],
].map(([name, code]) => ({ name, code }));

export const STATE_NAMES = STATES.map((s) => s.name);
export const stateByName = (name) => STATES.find((s) => s.name.toLowerCase() === String(name || '').trim().toLowerCase()) || null;

/** 15 characters: 2-digit state, 10-character PAN, entity number, 'Z', check character. */
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
