# Rummy

Juego de fichas en tiempo real para 2 a 4 personas. React y Vite sirven el tablero. Node.js, Express y Socket.IO gestionan las salas y validan cada turno.

## Arranque con Docker

```sh
docker compose up --build
```

Abre [http://localhost:8080](http://localhost:8080). Para jugar en la misma máquina, abre una segunda sesión en otro perfil o ventana privada. Puedes ajustar el puerto publicado con la variable `RUMMY_PORT`.

El contenedor de Nginx sirve la aplicación y reenvía `/socket.io/` al servidor en la red de Compose. `/health` comprueba que el servidor responde a través del proxy.

### Jugar en la misma red

Conecta los dispositivos al mismo Wi‑Fi. En el equipo que ejecuta Docker, usa `ipconfig` en Windows para encontrar la IPv4 del adaptador Wi‑Fi activo. Abre `http://IP-DEL-EQUIPO:8080`, crea la sala y pulsa **Copiar enlace**. Los invitados pueden abrir ese enlace o introducir el código en la misma dirección.

Si el enlace solo abre en el equipo anfitrión, comprueba que ambos dispositivos estén en una red que permita la comunicación entre ellos. En Windows, si es tu Wi‑Fi de confianza, puedes marcarla como **Privada** y permitir el puerto desde la subred local con PowerShell como administrador.

```powershell
New-NetFirewallRule -DisplayName "Rummy LAN TCP 8080" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8080 -Profile Private -RemoteAddress LocalSubnet
```

[Configurar el firewall de Windows](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/configure-with-command-line)

### Jugar por internet

El perfil `internet` levanta un túnel temporal de Cloudflare hacia Nginx y genera una dirección HTTPS compartible.

```sh
docker compose --profile internet up -d --build
docker compose --profile internet logs -f tunnel
```

Abre el enlace `https://…trycloudflare.com` de los logs. Crea la sala desde esa dirección y pulsa **Copiar enlace**. Cualquier persona con la URL puede abrir el juego y unirse a una sala con su código. Al detener el túnel se cierra el acceso por esa URL y, al iniciarlo de nuevo, se genera otra. Para una dirección estable, usa un túnel administrado con tu dominio. [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

```sh
docker compose --profile internet stop tunnel
```

## Juego

1. Escribe tu nombre y crea una sala. Envía el código o el enlace a los demás jugadores. El anfitrión puede iniciar la partida cuando haya dos o más personas conectadas.
2. Al iniciar, las fichas se reparten boca abajo. Las restantes se apilan y pasan al pozo, junto al marcador superior.
3. Durante tu turno, selecciona una ficha y pulsa su destino o arrástrala. Un arrastre rápido mueve una sola ficha. Una pulsación más larga permite arrastrar el grupo válido que la incluye. Puedes hacer lo mismo al tocar una ficha y elegir **Bajar fichas juntas**. Ordenar por número prioriza tríos y cuartetos, y ordenar por color prioriza escaleras. En el teléfono, mantén una pulsación breve para arrastrar una ficha y desliza enseguida para recorrer un atril largo.
4. Coloca las escaleras en orden ascendente. El juego mantiene cada ficha en su sitio si el destino es incompatible. Cuando creas un grupo, puedes dejar espacios para completar la escalera.
5. Para abrir, baja al menos 30 puntos en grupos formados desde tu atril. A partir del turno siguiente puedes reorganizar la mesa.
6. Para recuperar un comodín, muévelo o coloca encima una ficha que encaje en su lugar. Antes de confirmar, úsalo en otro grupo y deja toda la mesa en grupos válidos.
7. **Confirmar jugada** publica la mesa validada. **Reiniciar turno** restaura la mesa y el orden del atril al comienzo del turno. **Robar ficha** descarta el borrador, añade una ficha y cede el turno.

Con el pozo vacío, **Pasar** indica que el jugador no hará una jugada. Una ronda completa de pasos consecutivos cierra la partida por puntos del atril. Cada comodín restante vale 30 puntos y, si hay igualdad en el mínimo, la victoria es compartida. [Reglas de Rummikub Classic](https://rummikub.com/wp-content/uploads/2025/06/4600-0236-0013-EN-_rummikub-Classic.pdf)

El asiento se recupera al recargar la misma pestaña mediante `sessionStorage`. Las salas y las partidas residen en la memoria del servidor y se pierden al reiniciarlo. Una desconexión temporal durante la partida conserva el asiento y el orden de turnos.

## Chat y reacciones

Abre **Chat** desde la sala de espera o durante la partida. Puedes escribir a los demás jugadores, reaccionar a un mensaje o enviar una reacción rápida de risa, llanto, enojo o celebración que aparece junto a tu nombre. Con el chat cerrado, cada mensaje nuevo aparece brevemente en una burbuja animada junto a quien lo envió y también se cuenta en el botón del chat. El historial de la sala conserva los últimos 80 mensajes mientras exista la sala en el servidor.

## Desarrollo y pruebas

```sh
npm --prefix server ci
npm --prefix client ci
npm --prefix server test
npm --prefix client run build
```

Para desarrollar sin Docker, ejecuta `npm --prefix server run dev` y `npm --prefix client run dev` en terminales separadas. Abre [http://localhost:5173](http://localhost:5173).
