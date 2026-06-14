<p align="center">
  <img src="extansion/images/icon-128.png" width="96" alt="Logo de Smart Preload">
</p>

# Smart Preload / Zero Latency Web

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | Español | [Português (Brasil)](README.pt-BR.md) | [Русский](README.ru.md)

Smart Preload es una extension para Chrome y Edge que precarga de forma mas activa las paginas que probablemente abriras a continuacion. Combina puntuacion de enlaces, historial de actividad de pestanas, precarga al pasar el cursor y una app auxiliar de Windows para controlar mejor las ventanas en segundo plano.

## Descarga

Descarga la version mas reciente desde [GitHub Releases](https://github.com/kingstonwang114514-cloud/zero-latency-web/releases/latest).

La app de Windows es opcional, pero recomendable. Solo esta disponible para Windows y se usa para Native Messaging, recuperacion por watchdog, capturas de rendimiento y control de ventanas en segundo plano.

## Instalacion

1. Instala o activa primero la extension en Chrome o Edge.
2. Extrae el paquete de la app de Windows.
3. Ejecuta `install-register.cmd` desde la carpeta app extraida, o inicia la app una vez.
4. Despues del primer enlace correcto, la extension puede iniciar automaticamente la app local.

Si la app no se detecta durante aproximadamente un minuto, la extension puede sugerir descargar la app o activar el modo de precarga totalmente nativo.

## Funciones

- Planificacion global de precarga entre pestanas visibles, no solo en la pestana actual.
- Presupuestos separados para precargas normales y precargas reales de pestanas en segundo plano.
- Precarga independiente al pasar el cursor sobre enlaces o al hacer clic derecho en enlaces.
- Exclusiones para paginas locales, paginas de red privada, paginas de Google, ventanas de incognito y navegacion con proxy configurado.
- Seleccion manual del idioma de la interfaz ademas de la deteccion automatica del idioma del navegador.
- Los datos historicos locales se guardan en una carpeta portable y pueden copiarse a otro equipo o a una nueva version.

## Notas

- Navegadores compatibles: versiones basadas en Chromium de Google Chrome y Microsoft Edge.
- App nativa: solo Windows.
- El orden del primer enlace es importante: instala o activa primero la extension y luego ejecuta el registro de la app.
- La logica de prediccion permanece en la extension. La app local no ejecuta modelos AI locales ni guarda claves de proveedores AI.
