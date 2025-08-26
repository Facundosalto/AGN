# AGN
# CRM Vacantes — Supabase

Stack: HTML estático + TailwindCDN + supabase-js v2.

## Archivos
- `index.html` → Estructura de la app y secciones (Login, Dashboard, Disponibilidad, Admin).
- `styles.css` → Estilos mínimos.
- `js/config.js` → **Tus credenciales Supabase**.
- `js/app.js` → Auth, disponibilidad, asignaciones, admin.
- `js/dashboard.js` → Dashboard y calendario con cupos/disp.
- `supabase.sql` → Esquema, reglas, RLS + función para dashboard.

## Pasos
1) En Supabase (Database → SQL Editor), ejecutar **todo** `supabase.sql`.
2) En `js/config.js` ya están tus credenciales (URL y anon key).
3) Abrir `index.html` local o publicar (GitHub Pages / Vercel / Netlify).
4) Crear usuario (signup) y en tabla `profiles` poner `role='admin'` a tu usuario.
5) Como **worker**, cargan su disponibilidad por rango y consultan el **calendario** para ver días **con vacantes**.
6) Como **admin**, usás el Panel para ver solicitudes, proponer/confirmar y exportar CSV.

> Importante: En Supabase → Auth → **Redirect URLs** agregá la URL pública de tu sitio.
