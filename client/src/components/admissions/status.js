export const STATUS = {
  draft: { label: 'Draft - not submitted', tone: 'gray' },
  submitted: { label: 'Submitted - under review', tone: 'blue' },
  documents_pending: { label: 'Documents need attention', tone: 'amber' },
  accepted: { label: 'Accepted', tone: 'green' },
  waitlisted: { label: 'Waitlisted', tone: 'purple' },
  rejected: { label: 'Not accepted', tone: 'red' },
  enrolled: { label: 'Enrolled', tone: 'green' },
};
export const DOC_LABEL = { photo: 'Passport-size photo', signature: 'Signature', id_proof: 'ID proof', marksheet: 'Previous marksheet', other: 'Other document' };
export const DOC_TONE = { pending: 'gray', verified: 'green', rejected: 'red' };
export const FEE_STATUS = {
  none: { label: 'No fee', tone: 'gray' },
  pending: { label: 'Fee pending', tone: 'amber' },
  paid: { label: 'Fee paid', tone: 'green' },
  waived: { label: 'Fee waived', tone: 'blue' },
};
export const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
