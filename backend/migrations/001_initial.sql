CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('student', 'admin')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courts (
  id integer PRIMARY KEY CHECK (id IN (1, 2)),
  name text NOT NULL UNIQUE
);
INSERT INTO courts (id, name) VALUES (1, 'Court 1'), (2, 'Court 2') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES users(id),
  court_id integer NOT NULL REFERENCES courts(id),
  date date NOT NULL CHECK (extract(isodow FROM date) BETWEEN 1 AND 5),
  hour integer NOT NULL CHECK (hour BETWEEN 16 AND 21),
  week_start date GENERATED ALWAYS AS (date - (extract(isodow FROM date)::integer - 1)) STORED,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_booking_per_student_week
  ON reservations(student_id, week_start) WHERE status = 'confirmed';

CREATE TABLE IF NOT EXISTS closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  court_id integer NOT NULL REFERENCES courts(id),
  date date NOT NULL CHECK (extract(isodow FROM date) BETWEEN 1 AND 5),
  start_hour integer NOT NULL CHECK (start_hour BETWEEN 16 AND 21),
  end_hour integer NOT NULL CHECK (end_hour BETWEEN 17 AND 22 AND end_hour > start_hour),
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Both kinds of occupation share this key, including concurrent requests.
CREATE TABLE IF NOT EXISTS court_slots (
  court_id integer NOT NULL REFERENCES courts(id),
  date date NOT NULL,
  hour integer NOT NULL CHECK (hour BETWEEN 16 AND 21),
  reservation_id uuid UNIQUE REFERENCES reservations(id) ON DELETE CASCADE,
  closure_id uuid REFERENCES closures(id) ON DELETE CASCADE,
  PRIMARY KEY (court_id, date, hour),
  CHECK ((reservation_id IS NOT NULL) <> (closure_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS court_slots_closure ON court_slots(closure_id);
CREATE INDEX IF NOT EXISTS reservations_date ON reservations(date);

CREATE TABLE IF NOT EXISTS session (
  sid varchar PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS session_expire ON session(expire);
