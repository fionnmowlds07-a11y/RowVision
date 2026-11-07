-- Local development only. Hosted accounts are approved on the admin page.
insert into public.approved_emails (email, note) values
  ('admin@example.com', 'Local admin'),
  ('athlete@example.com', 'Local athlete');
