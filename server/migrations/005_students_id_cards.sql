-- Students module + ID cards: a student's own portrait (carried over from a verified admission
-- document, or uploaded directly by an admin) and simple per-card validity.
alter table students
  add column photo_file_id uuid,
  add column card_valid_till date;

alter table students
  add constraint students_photo_fk foreign key (tenant_id, photo_file_id) references files (tenant_id, id) on delete set null;

-- Applications already point at a file; let an accepted photo be looked up quickly on enrolment.
create index appdocs_photo_ix on application_documents (tenant_id, application_id) where doc_type = 'photo';
