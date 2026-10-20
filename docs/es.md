# ESPSomfy RTS

## Presentación

Esta integración lleva sus motores **Somfy RTS** a Gladys gracias a un controlador **ESPSomfy RTS**: persianas enrollables, estores venecianos y sus lamas, toldos, cortinas, puertas de garaje y portones, en las estancias y las escenas, con su posición, su posición favorita «My» y su sensor de sol y viento.

[ESPSomfy RTS](https://github.com/rstrouse/ESPSomfy-RTS) es un firmware libre para un ESP32 con una radio de 433 MHz (CC1101). Envía las tramas de radio de un mando Somfy RTS, así que controla los motores sin ninguna caja Somfy, y escucha sus mandos, así que sabe adónde fue cada persiana. Estima las posiciones a partir de los tiempos de recorrido ajustados en su página web.

**Funcionamiento**: todo se queda en su **red local**. Gladys encuentra el controlador sola (SSDP), lee sus persianas y sus grupos, y mantiene una conexión abierta con él: cada movimiento, venga de Gladys, de un mando o de la página web del controlador, aparece al instante, nada se consulta en bucle. Sin cuenta, sin nube. Esta integración no es oficial y no tiene relación con Somfy ni con los autores de ESPSomfy RTS.

## Requisitos

- Gladys Assistant 5.1.0 o posterior.
- Un controlador ESPSomfy RTS con firmware 2.4 o posterior, conectado a **la misma red que Gladys** (Wi-Fi o Ethernet).
- Sus persianas y grupos **creados y emparejados en la página web del controlador**: la integración no empareja motores, usa lo que conoce el controlador.
- En la instalación, acepte la **detección de red** (SSDP), que permite a Gladys encontrar el controlador. La opción **SSDP broadcast** del controlador debe seguir activa (lo está por defecto); si no, escriba su dirección en la configuración.

## Configuración

### Controladores

Nada es obligatorio: guarde la configuración y pulse **Buscar los controladores**. El mensaje lista cada controlador encontrado con su dirección, su firmware y su número de persianas y grupos.

- **Direcciones IP de los controladores**: solo para un controlador que la búsqueda no encuentra (otra subred, una red que filtra el multicast, SSDP desactivado), separadas por comas. Dé una dirección fija a su controlador en su router: un controlador cuya dirección cambió se vuelve a encontrar por su identificador, pero antes con una dirección fija.
- **Volver a buscar en la red**: cada hora (por defecto), cada 15 minutos o nunca. Útil para un controlador nuevo, una persiana añadida en la página web o una dirección cambiada por el router. Un controlador que deja de responder se vuelve a contactar de todos modos.

### Idioma

**Idioma de los textos**: nombres de las funciones y mensajes de error de las escenas, porque Gladys no envía su idioma con ellos.

## Uso

### Dispositivos

Abra la pestaña **Descubrir** de la integración y añada sus persianas y grupos. Cada uno se convierte en un dispositivo de Gladys, con el nombre del controlador:

- **Persiana enrollable, contraventana, estor veneciano, toldo, puerta de garaje, portón de tres botones**: una persiana con **Abrir / cerrar** (abrir, parar, cerrar) y **Posición** (0 % = cerrada, 100 % = abierta).
- **Cortina**: una cortina con las mismas dos funciones.
- **Estor con motor de inclinación**: además **Lamas** (0 % = cerradas, 100 % = abiertas). Un estor solo de lamas tiene sus lamas como posición.
- **Puerta de garaje o portón de un botón**: solo **Abrir / cerrar**; el botón solo se pulsa si cambia algo.
- **Contacto seco**: un interruptor **Relé**.
- **Motor con sensor de sol, toldo**: además **Sensor de sol activo**, que deja que el sensor de sol mueva el motor, o no (el «sun flag» de Somfy).
- **Grupo**: **Abrir / cerrar** para todas sus persianas a la vez (y **Sensor de sol activo** si tiene uno). Un grupo no tiene posición.

**Parar** detiene una persiana en marcha; con una persiana quieta no hace nada (en Somfy, el mismo botón envía una persiana quieta a su posición «My»: use para ello la acción de escena o el widget). Las posiciones siguen las convenciones de la integración de Home Assistant del autor del firmware, incluida la opción **flip position** y los toldos (abierto = desplegado).

### Transporte

El catálogo muestra la insignia **local**: nada sale de su red. Cada dispositivo indica **local** mientras su controlador responde, **inaccesible** si no.

### Widgets

![El widget «Persiana Somfy»: el toldo de la terraza abierto al 65 % con un indicador, su estado, su posición «My» al 50 %, sol detectado, sin viento, sensor de sol activo, y los botones Abrir, My, Cerrar e Ignorar el sol; al lado el widget «Persianas Somfy» con seis persianas, su estado y su posición, y el controlador en línea por Wi-Fi (ilustración generada, no una captura de pantalla)](https://raw.githubusercontent.com/William-De71/gladys-espsomfy-rts/main/docs/assets/widgets.es.png)

- **Persiana Somfy**: una persiana o un grupo elegido en los ajustes: cuánto está abierta (indicador en directo), su estado, su **posición «My»**, las lamas, el sol y el viento, y los botones **Abrir**, **My**, **Cerrar** y el sensor de sol. **My** es la posición favorita guardada en el motor, para la que Gladys no tiene botón.
- **Persianas Somfy**: todas las persianas añadidas a Gladys, abiertas o cerradas de un vistazo (ocho como máximo), y el estado de los controladores con una actualización de firmware cuando hay una.

### Disparadores de escena

- **Se pulsa un mando Somfy**: se pulsa un mando, un pulsador de pared o un Situo emparejado con una persiana y el controlador lo oye. Filtro por persiana y por botón (▲ subir, ▼ bajar, My, My + subir…). Variables: nombre de la persiana, botón, dirección del mando. Las órdenes enviadas por Gladys o por el controlador nunca lo disparan.
- **Cambia el sol o el viento**: el sensor de sol y viento Somfy de un motor indica que llega o se va el sol o el viento. Filtro por persiana, sensor y estado.
- **Se pierde un controlador ESPSomfy RTS**: no responde desde hace un minuto (desenchufado, Wi-Fi perdido). Variables: nombre del controlador, dirección IP.
- **Vuelve un controlador ESPSomfy RTS**: vuelve a responder tras un evento «perdido».

### Acciones de escena

- **Enviar una orden Somfy** a una persiana o un grupo: **My** (posición favorita; detiene una persiana en marcha), abrir, cerrar, un paso hacia abierto o cerrado, sensor de sol activo o ignorado.
- **Corregir la posición de una persiana**: indica al controlador dónde está realmente la persiana, sin moverla (tras un mando que no oye o un corte de luz), con las lamas si las tiene.

### Ejemplos de escenas

- Cuando se pulsa **el botón «My» del mando del salón** → bajar las luces y encender la tele.
- Cuando se **detecta viento** en el toldo de la terraza → enviar una notificación (el motor lo recoge solo).
- Al atardecer → **Enviar una orden Somfy** «My» al grupo de la planta baja: cada persiana va a su posición favorita.

## Solución de problemas

- **No se encuentra ningún controlador**: compruebe que el controlador responde en `http://<su dirección>` desde un ordenador de la misma red, que su opción **SSDP broadcast** está activa y que aceptó la detección de red al instalar (si no, reinstale la integración). O escriba su dirección en **Direcciones IP de los controladores**.
- **Falta una persiana**: créela en la página web del controlador y lance una búsqueda en la pestaña **Descubrir**.
- **La posición es incorrecta**: ESPSomfy RTS la estima a partir de los tiempos de recorrido ajustados en su página web y de las tramas que oye. Un mando que no oye mueve la persiana sin avisarle: use la acción **Corregir la posición de una persiana**, o vincule ese mando en la página web del controlador.
- **Las órdenes van al revés**: corríjalo en la página web del controlador (flip commands, flip position) y vuelva a añadir el dispositivo si la pestaña Descubrir propone una actualización.
- **Inaccesible**: el controlador se reinicia tras una actualización de firmware o una pérdida del Wi-Fi; Gladys se vuelve a conectar en menos de un minuto. La API HTTP (puerto 8081) y el socket (puerto 8080) deben ser accesibles desde Gladys.
- **Registros**: pestaña Registros de la página de la integración. Para más detalle, añada la variable de entorno `DEBUG=gladys-integration-sdk`.
