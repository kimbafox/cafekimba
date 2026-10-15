# API Kimba Café

Servidor Node.js/Express para sincronizar el cajero y los dispositivos que consultan pedidos.

## Despliegue en Railway

1. Crea un servicio **PostgreSQL** en el mismo proyecto de Railway.
2. Crea un servicio desde este repositorio y establece **Root Directory** en `server`.
3. En las variables del servicio API, agrega `DATABASE_URL` con la referencia a la variable `DATABASE_URL` del servicio PostgreSQL.
4. Railway detectará `npm start`, ejecutará [schema.sql](./schema.sql), creará las tablas y cargará el menú inicial al arrancar.
5. Copia la URL pública del servicio API.

## Compilar la aplicación Flutter

Usa la URL pública de Railway sin una barra final:

```powershell
flutter run --dart-define=API_BASE_URL=https://tu-api.up.railway.app
```

Sin `API_BASE_URL`, la aplicación funciona solamente con almacenamiento local.

## Esquema SQL

[schema.sql](./schema.sql) es el esquema completo de PostgreSQL. Puedes importarlo manualmente en la consola de Railway; el servidor también lo ejecuta automáticamente al iniciar.
