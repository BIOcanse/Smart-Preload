<p align="center">
  <img src="extansion/images/icon-128.png" width="96" alt="Logo do Smart Preload">
</p>

# Smart Preload / Zero Latency Web

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Español](README.es.md) | Português (Brasil) | [Русский](README.ru.md)

Smart Preload e uma extensao para Chrome e Edge que pre-carrega com mais iniciativa as paginas que voce provavelmente abrira em seguida. Ela combina pontuacao de links, historico de atividade das abas, pre-carregamento ao passar o mouse e um app auxiliar do Windows para controlar melhor janelas em segundo plano.

## Download

Baixe a versao mais recente em [GitHub Releases](https://github.com/kingstonwang114514-cloud/zero-latency-web/releases/latest).

O app do Windows e opcional, mas recomendado. Ele esta disponivel apenas para Windows e e usado para Native Messaging, recuperacao por watchdog, snapshots de desempenho e controle de janelas em segundo plano.

## Instalacao

1. Instale ou ative primeiro a extensao no Chrome ou Edge.
2. Extraia o pacote do app do Windows.
3. Execute `install-register.cmd` na pasta app extraida, ou inicie o app uma vez.
4. Depois da primeira vinculacao bem-sucedida, a extensao pode iniciar automaticamente o app local.

Se o app nao for detectado por cerca de um minuto, a extensao pode sugerir baixar o app ou ativar o modo de pre-carregamento totalmente nativo.

## Recursos

- Agendamento global de pre-carregamento entre abas visiveis, nao apenas na aba atual.
- Orcamentos separados para pre-carregamentos normais e pre-carregamentos reais de abas em segundo plano.
- Pre-carregamento independente ao passar o mouse sobre links ou ao clicar com o botao direito em links.
- Exclusoes para paginas locais, paginas de rede privada, paginas do Google, janelas anonimas e navegacao por proxy configurada.
- Selecao manual do idioma da interface alem da deteccao automatica do idioma do navegador.
- Os dados historicos locais ficam em uma pasta portatil e podem ser copiados para outro computador ou para uma nova versao.

## Observacoes

- Navegadores compatíveis: versoes baseadas em Chromium do Google Chrome e Microsoft Edge.
- App nativo: somente Windows.
- A ordem da primeira vinculacao e importante: instale ou ative primeiro a extensao e depois execute o registro do app.
- A logica de previsao permanece na extensao. O app local nao executa modelos AI locais nem armazena chaves de provedores AI.
