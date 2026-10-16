-- =====================================================================
-- Class teacher
--
-- A school takes ONE attendance register a day for each class, and it is taken by that class's teacher. Colleges and
-- universities do not use this for attendance (they take a register for every lecture, by the lecture's own teacher),
-- but they may still name a class coordinator here.
-- Optional: a class with no class teacher falls back to the teacher of its first period, so nothing breaks.
-- =====================================================================
alter table courses add column class_teacher_id uuid;
alter table courses add constraint courses_class_teacher_fk
  foreign key (tenant_id, class_teacher_id) references employees (tenant_id, id) on delete set null (class_teacher_id);
