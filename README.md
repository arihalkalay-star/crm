# Alkalay CRM

A small personal CRM: clients, deals, tasks (table + kanban), updates timeline.
Static site (GitHub Pages) + Supabase (auth + Postgres with row level security).

- `sql/schema.sql` – run once in the Supabase SQL editor.
- `config.js` – Supabase project URL + anon/publishable key (public by design; data is protected by login + RLS).
