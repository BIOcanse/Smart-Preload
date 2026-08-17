# Política de privacidad de Smart Preload

Última actualización: 31 de julio de 2026

[English](PRIVACY.md) | [简体中文](PRIVACY.zh-CN.md) | [繁體中文](PRIVACY.zh-TW.md) | [日本語](PRIVACY.ja.md) | [한국어](PRIVACY.ko.md) | [Deutsch](PRIVACY.de.md) | [Français](PRIVACY.fr.md) | Español | [Português (Brasil)](PRIVACY.pt-BR.md) | [Русский](PRIVACY.ru.md)

Esta política se aplica a la extensión de navegador Smart Preload y a la aplicación complementaria opcional para Windows.

Smart Preload usa algoritmos inteligentes de precarga para reducir los tiempos de espera percibidos. Para hacerlo, procesa señales relacionadas con la navegación en tu perfil del navegador y en tu dispositivo. El desarrollador no opera un servidor que recopile tu historial de navegación, no vende datos de usuario y no comparte datos de usuario con anunciantes, intermediarios de analítica ni intermediarios de datos.

## Datos procesados localmente

Smart Preload puede procesar y almacenar localmente los siguientes datos:

- URL de páginas, hosts, títulos y transiciones de navegación.
- Enlaces candidatos encontrados en páginas, incluidas URL de enlaces, texto de enlace y texto cercano usado para la clasificación.
- Estado de pestañas, ventanas, precargas y prefetch necesario para gestionar páginas preparadas.
- Señales de interacción como hover sobre enlaces, intención de precarga desde el menú contextual, actividad de la pestaña en primer plano, tiempo activo reciente y estado de medios/actividad usado por la planificación.
- Títulos y URL de marcadores cuando las funciones de precarga basadas en marcadores están habilitadas.
- Cuando la predicción AI está habilitada, un breve extracto del texto de las páginas que visitas (hasta 2.200 caracteres). Se usa para la puntuación de palabras clave y relevancia y se conserva hasta 180 días. Estos extractos también se incluyen en las copias de seguridad de historial que exportas desde la página de ajustes.
- Configuración de la extensión, límites de precarga, ajustes de seguridad, estadísticas locales de historial, ajustes del proveedor AI y registros de diagnóstico cuando los diagnósticos están habilitados.

Estos datos locales se usan solo para proporcionar funciones de Smart Preload: predicción, clasificación, planificación de precarga, filtrado de seguridad, eliminación de historial local, diagnóstico y puntuación asistida por AI opcional.

## Datos enviados fuera de tu dispositivo

Smart Preload no envía el historial de navegación ni el historial de precarga al desarrollador.

Los datos pueden salir de tu dispositivo solo en estos casos:

- Si habilitas un proveedor AI externo e introduces una API key o endpoint, la extensión envía a ese proveedor contexto de la página para la puntuación de palabras clave y relevancia. Ese contexto incluye:
  - la URL completa, el título y hasta los primeros 2.200 caracteres del texto visible de la página que estás viendo;
  - para la puntuación de relevancia, la URL, el título y un extracto de texto de otras pestañas abiertas en la misma ventana (hasta 8) y de páginas vistas recientemente y páginas de historial almacenadas (hasta 5 de cada una).

  La predicción AI está desactivada de forma predeterminada y solo se ejecuta después de que selecciones un proveedor e introduzcas una API key. La política de privacidad de ese proveedor se aplica a esas solicitudes. **Si no quieres que el contenido de las páginas se envíe a una empresa externa, usa un endpoint AI local (ver abajo) o deja la predicción AI desactivada.**
- Si usas un endpoint AI local como LM Studio, el mismo contexto se envía únicamente al endpoint que configuraste en tu propia máquina y no llega a ninguna empresa externa.
- Si la aplicación complementaria de Windows está en ejecución, la extensión contacta la API de GitHub Releases cada vez que abres la página de ajustes de la extensión, para mostrar si hay una actualización disponible de la aplicación complementaria. También contacta páginas de GitHub releases o archivos alojados en GitHub cuando descargas una actualización.
- Cuando visitas realmente una página, o cuando una función de precarga carga una página en el navegador, ocurre la comunicación de red normal del navegador. El sitio de destino puede recibir solicitudes, cookies e información de sesión ordinarias, como en una carga normal de página.

## Aplicación complementaria opcional para Windows

La aplicación complementaria opcional para Windows ayuda a mantener ocultas las ventanas reales de precarga y admite integración local con el sistema. Se comunica con la extensión en el mismo dispositivo mediante Chrome/Edge native messaging. Puede procesar localmente metadatos de ventanas del navegador e información de rendimiento/actividad del sistema para gestionar el comportamiento de precarga. No envía el historial de navegación al desarrollador.

## Almacenamiento y eliminación

Smart Preload almacena sus datos en el almacenamiento local de la extensión del navegador y en archivos locales relacionados usados por la extensión o la aplicación complementaria. Puedes eliminar rangos seleccionados del historial local desde la página de configuración de la extensión. También puedes eliminar los datos almacenados desinstalando la extensión o borrando los datos de extensión del perfil del navegador.

## Permisos

Smart Preload solicita permisos del navegador solo para admitir sus funciones, incluido el manejo de pestañas y eventos de navegación, almacenamiento local, funciones de precarga basadas en marcadores, native messaging con la aplicación complementaria opcional y comprobaciones de mantenimiento programadas.

## Sin venta ni uso publicitario

El desarrollador no vende, alquila ni comparte datos de usuario con anunciantes, intermediarios de analítica u otros terceros para seguimiento, perfilado o publicidad.

## Limited Use de Chrome Web Store

El uso que Smart Preload hace de la información recibida de las API de extensión de Chrome se limita a proporcionar y mejorar su único propósito: reducir los tiempos de espera percibidos mediante predicción local y precarga. El uso de esta información por parte de Smart Preload cumple con la Chrome Web Store User Data Policy, incluidos los requisitos de Limited Use.

## Privacidad de menores

Smart Preload no está dirigido a menores y no recopila conscientemente información personal de menores.

## Cambios

Esta política puede actualizarse cuando Smart Preload cambie su forma de tratar los datos. La versión más reciente se publicará en este repositorio.

## Contacto

Para preguntas sobre privacidad: biocanse@gmail.com
