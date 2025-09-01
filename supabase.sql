-- ============ TIPOS ENUM ============
DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM ('admin','worker');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.assign_status AS ENUM ('propuesto','confirmado','rechazado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.day_kind AS ENUM ('habil','finde_fer','todos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ PROFILES ============
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT,
  role public.user_role NOT NULL DEFAULT 'worker',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ MAESTRAS ============
CREATE TABLE IF NOT EXISTS public.locations (
  id SMALLSERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
INSERT INTO public.locations (name)
VALUES ('Ubicación 1'), ('Ubicación 2')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.shifts (
  id SMALLSERIAL PRIMARY KEY,
  label TEXT UNIQUE NOT NULL CHECK (label IN ('07-19','19-07')),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL
);
INSERT INTO public.shifts (label, start_time, end_time) VALUES
('07-19','07:00','19:00'),
('19-07','19:00','07:00')
ON CONFLICT (label) DO NOTHING;

-- ============ REGLAS DE CUPOS ============
CREATE TABLE IF NOT EXISTS public.vacancy_rules (
  id BIGSERIAL PRIMARY KEY,
  location_id SMALLINT REFERENCES public.locations(id) ON DELETE CASCADE,
  shift_label TEXT NOT NULL CHECK (shift_label IN ('07-19','19-07')),
  day_kind public.day_kind NOT NULL,
  cupos INT NOT NULL CHECK (cupos>=0),
  UNIQUE(location_id, shift_label, day_kind)
);

INSERT INTO public.vacancy_rules (location_id, shift_label, day_kind, cupos) VALUES
(1,'07-19','habil',5),
(1,'07-19','finde_fer',2),
(1,'19-07','todos',3),
(2,'07-19','habil',2),
(2,'07-19','finde_fer',1),
(2,'19-07','todos',1)
ON CONFLICT (location_id, shift_label, day_kind) DO UPDATE SET cupos = EXCLUDED.cupos;

-- ============ FERIADOS ============
CREATE TABLE IF NOT EXISTS public.holidays (
  day DATE PRIMARY KEY
);

-- ============ DISPONIBILIDADES ============
CREATE TABLE IF NOT EXISTS public.availabilities (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  location_id SMALLINT REFERENCES public.locations(id) ON DELETE CASCADE,
  shift_label TEXT NOT NULL CHECK (shift_label IN ('07-19','19-07')),
  day DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, location_id, shift_label, day)
);

-- ============ ASIGNACIONES ============
CREATE TABLE IF NOT EXISTS public.assignments (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  location_id SMALLINT REFERENCES public.locations(id) ON DELETE CASCADE,
  shift_label TEXT NOT NULL CHECK (shift_label IN ('07-19','19-07')),
  day DATE NOT NULL,
  status public.assign_status NOT NULL DEFAULT 'propuesto',
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, location_id, shift_label, day)
);

-- ============ FUNCIONES ============
CREATE OR REPLACE FUNCTION public.is_weekend_or_holiday(d DATE)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT EXTRACT(ISODOW FROM d) IN (6,7) OR EXISTS (SELECT 1 FROM public.holidays h WHERE h.day = d);
$$;

-- ============ VISTAS ============
CREATE OR REPLACE VIEW public.vacancy_capacity AS
SELECT
  g.d::date AS day,
  l.id       AS location_id,
  s.label    AS shift_label,
  CASE 
    WHEN public.is_weekend_or_holiday(g.d::date) THEN COALESCE((
      SELECT cupos FROM public.vacancy_rules r
      WHERE r.location_id = l.id AND r.shift_label = s.label AND r.day_kind IN ('finde_fer','todos')
      ORDER BY CASE r.day_kind WHEN 'finde_fer' THEN 1 ELSE 2 END
      LIMIT 1
    ),0)
    ELSE COALESCE((
      SELECT cupos FROM public.vacancy_rules r
      WHERE r.location_id = l.id AND r.shift_label = s.label AND r.day_kind IN ('habil','todos')
      ORDER BY CASE r.day_kind WHEN 'habil' THEN 1 ELSE 2 END
      LIMIT 1
    ),0)
  END AS cupos
FROM generate_series((now() - interval '30 days')::date, (now() + interval '180 days')::date, interval '1 day') AS g(d)
CROSS JOIN public.locations l
CROSS JOIN public.shifts s;

CREATE OR REPLACE VIEW public.vacancy_status AS
SELECT
  vc.day,
  vc.location_id,
  vc.shift_label,
  vc.cupos,
  (SELECT COUNT(*) FROM public.assignments a
     WHERE a.day=vc.day AND a.location_id=vc.location_id AND a.shift_label=vc.shift_label
       AND a.status IN ('propuesto','confirmado')) AS ocupados,
  vc.cupos - (SELECT COUNT(*) FROM public.assignments a
     WHERE a.day=vc.day AND a.location_id=vc.location_id AND a.shift_label=vc.shift_label
       AND a.status IN ('propuesto','confirmado')) AS disponibles
FROM public.vacancy_capacity vc;

-- NUEVA VISTA: historial completo por persona (disponibilidades + asignaciones)
CREATE OR REPLACE VIEW public.v_user_activity AS
SELECT
  'disponibilidad'::text AS kind,
  v.id,
  v.created_at,
  v.day,
  v.user_id,
  p.full_name,
  u.email,
  v.location_id,
  l.name AS location_name,
  v.shift_label,
  NULL::public.assign_status AS status
FROM public.availabilities v
JOIN public.profiles p ON p.id = v.user_id
JOIN auth.users u ON u.id = v.user_id
JOIN public.locations l ON l.id = v.location_id
UNION ALL
SELECT
  'asignacion'::text AS kind,
  a.id,
  a.created_at,
  a.day,
  a.user_id,
  p.full_name,
  u.email,
  a.location_id,
  l.name AS location_name,
  a.shift_label,
  a.status
FROM public.assignments a
JOIN public.profiles p ON p.id = a.user_id
JOIN auth.users u ON u.id = a.user_id
JOIN public.locations l ON l.id = a.location_id;

-- ============ RLS ============
ALTER TABLE public.profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vacancy_rules  ENABLE ROW LEVEL SECURITY;

-- Profiles
DROP POLICY IF EXISTS profiles_self_select ON public.profiles;
CREATE POLICY profiles_self_select ON public.profiles FOR SELECT USING (
  auth.uid() = id OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);
DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_self_update ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Availabilities
DROP POLICY IF EXISTS avail_insert_self ON public.availabilities;
CREATE POLICY avail_insert_self ON public.availabilities FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS avail_select_self_or_admin ON public.availabilities;
CREATE POLICY avail_select_self_or_admin ON public.availabilities FOR SELECT USING (
  auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);
DROP POLICY IF EXISTS avail_delete_admin ON public.availabilities;
CREATE POLICY avail_delete_admin ON public.availabilities FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

-- Assignments
DROP POLICY IF EXISTS asg_select_self_or_admin ON public.assignments;
CREATE POLICY asg_select_self_or_admin ON public.assignments FOR SELECT USING (
  user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);
DROP POLICY IF EXISTS asg_modify_admin ON public.assignments;
CREATE POLICY asg_modify_admin ON public.assignments FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

-- Rules & Holidays
DROP POLICY IF EXISTS rules_read_admin ON public.vacancy_rules;
CREATE POLICY rules_read_admin ON public.vacancy_rules FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);
DROP POLICY IF EXISTS rules_write_admin ON public.vacancy_rules;
CREATE POLICY rules_write_admin ON public.vacancy_rules FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

DROP POLICY IF EXISTS holi_read_admin ON public.holidays;
CREATE POLICY holi_read_admin ON public.holidays FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);
DROP POLICY IF EXISTS holi_write_admin ON public.holidays;
CREATE POLICY holi_write_admin ON public.holidays FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

-- ============ PERMISOS ============
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.locations, public.shifts TO authenticated;
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.availabilities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assignments   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vacancy_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.holidays      TO authenticated;

-- Lectura de vistas
GRANT SELECT ON public.vacancy_capacity, public.vacancy_status, public.v_user_activity TO authenticated;

-- ============ RPC ============
CREATE OR REPLACE FUNCTION public.vacancy_status_range(
  start_d date,
  end_d   date,
  loc     int,
  shift   text
)
RETURNS TABLE(day date, location_id int, shift_label text, cupos int, ocupados int, disponibles int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT vs.day, vs.location_id, vs.shift_label, vs.cupos, vs.ocupados, vs.disponibles
  FROM public.vacancy_status vs
  WHERE vs.day BETWEEN start_d AND end_d
    AND (loc   IS NULL OR vs.location_id = loc)
    AND (shift IS NULL OR vs.shift_label = shift)
  ORDER BY vs.day, vs.location_id, vs.shift_label;
$$;

GRANT EXECUTE ON FUNCTION public.vacancy_status_range(date, date, int, text) TO authenticated;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS dni TEXT,
  ADD COLUMN IF NOT EXISTS cuil TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cuil TEXT;

