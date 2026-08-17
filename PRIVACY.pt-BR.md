# Política de Privacidade do Smart Preload

Última atualização: 31 de julho de 2026

[English](PRIVACY.md) | [简体中文](PRIVACY.zh-CN.md) | [繁體中文](PRIVACY.zh-TW.md) | [日本語](PRIVACY.ja.md) | [한국어](PRIVACY.ko.md) | [Deutsch](PRIVACY.de.md) | [Français](PRIVACY.fr.md) | [Español](PRIVACY.es.md) | Português (Brasil) | [Русский](PRIVACY.ru.md)

Esta política se aplica à extensão de navegador Smart Preload e ao aplicativo complementar opcional para Windows.

O Smart Preload usa algoritmos inteligentes de pré-carregamento para reduzir o tempo de espera percebido. Para isso, ele processa sinais relacionados à navegação no perfil do navegador e no seu dispositivo. O desenvolvedor não opera um servidor que colete seu histórico de navegação, não vende dados de usuário e não compartilha dados de usuário com anunciantes, corretores de análise ou corretores de dados.

## Dados processados localmente

O Smart Preload pode processar e armazenar localmente os seguintes dados:

- URLs de páginas, hosts, títulos e transições de navegação.
- Links candidatos encontrados nas páginas, incluindo URLs de links, texto do link e texto próximo usado para classificação.
- Estado de abas, janelas, pré-carregamento e prefetch necessário para gerenciar páginas preparadas.
- Sinais de interação, como hover em links, intenção de pré-carregamento pelo menu de contexto, atividade da aba em primeiro plano, tempo ativo recente e estado de mídia/atividade usado pelo agendamento.
- Títulos e URLs de favoritos quando os recursos de pré-carregamento baseados em favoritos estão ativados.
- Quando a previsão AI está ativada, um breve trecho do texto das páginas que você visita (até 2.200 caracteres). Ele é usado para pontuação por palavras-chave e relevância e é mantido por até 180 dias. Esses trechos também são incluídos nos backups de histórico que você exporta na página de configurações.
- Configurações da extensão, limites de pré-carregamento, configurações de segurança, estatísticas de histórico local, configurações de provedor AI e logs de diagnóstico quando os diagnósticos estão ativados.

Esses dados locais são usados apenas para fornecer os recursos do Smart Preload: previsão, classificação, agendamento de pré-carregamento, filtragem de segurança, exclusão de histórico local, diagnósticos e pontuação assistida por AI opcional.

## Dados enviados para fora do seu dispositivo

O Smart Preload não envia histórico de navegação nem histórico de pré-carregamento ao desenvolvedor.

Os dados podem sair do seu dispositivo apenas nestes casos:

- Se você ativar um provedor AI externo e inserir uma API key ou endpoint, a extensão envia a esse provedor o contexto da página para pontuação por palavras-chave e relevância. Esse contexto inclui:
  - a URL completa, o título e até os primeiros 2.200 caracteres do texto visível da página que você está vendo;
  - para pontuação de relevância, a URL, o título e um trecho de texto de outras abas abertas na mesma janela (até 8) e de páginas vistas recentemente e páginas de histórico armazenadas (até 5 de cada).

  A previsão AI vem desativada por padrão e só é executada depois que você seleciona um provedor e insere uma API key. A política de privacidade desse provedor se aplica a essas solicitações. **Se você não quiser que o conteúdo das páginas seja enviado a uma empresa externa, use um endpoint AI local (veja abaixo) ou mantenha a previsão AI desativada.**
- Se você usar um endpoint AI local, como LM Studio, o mesmo contexto é enviado apenas ao endpoint que você configurou na sua própria máquina e não chega a nenhuma empresa terceira.
- Se o aplicativo complementar para Windows estiver em execução, a extensão acessa a API de GitHub Releases toda vez que você abre a página de configurações da extensão, para mostrar se há uma atualização do aplicativo complementar disponível. Ela também acessa páginas de GitHub releases ou arquivos hospedados pelo GitHub quando você baixa uma atualização.
- Quando você realmente visita uma página, ou quando um recurso de pré-carregamento carrega uma página no navegador, ocorre a comunicação normal de rede do navegador. O site de destino pode receber solicitações, cookies e informações de sessão comuns, como em um carregamento normal de página.

## Aplicativo complementar opcional para Windows

O aplicativo complementar opcional para Windows ajuda a manter ocultas as janelas reais de pré-carregamento e oferece integração local com o sistema. Ele se comunica com a extensão no mesmo dispositivo por meio de Chrome/Edge native messaging. Ele pode processar localmente metadados de janelas do navegador e informações de desempenho/atividade do sistema para gerenciar o comportamento de pré-carregamento. Ele não envia histórico de navegação ao desenvolvedor.

## Armazenamento e exclusão

O Smart Preload armazena seus dados no armazenamento local da extensão do navegador e em arquivos locais relacionados usados pela extensão ou pelo aplicativo complementar. Você pode excluir intervalos selecionados do histórico local na página de configurações da extensão. Também pode remover os dados armazenados desinstalando a extensão ou limpando os dados da extensão no perfil do navegador.

## Permissões

O Smart Preload solicita permissões do navegador apenas para oferecer suporte aos seus recursos, incluindo manipulação de abas e eventos de navegação, armazenamento local, recursos de pré-carregamento baseados em favoritos, native messaging com o aplicativo complementar opcional e verificações de manutenção agendadas.

## Sem venda ou uso publicitário

O desenvolvedor não vende, aluga nem compartilha dados de usuário com anunciantes, corretores de análise ou outros terceiros para rastreamento, criação de perfil ou publicidade.

## Limited Use da Chrome Web Store

O uso, pelo Smart Preload, das informações recebidas das APIs de extensão do Chrome é limitado a fornecer e melhorar seu único propósito: reduzir o tempo de espera percebido por meio de previsão local e pré-carregamento. O uso dessas informações pelo Smart Preload segue a Chrome Web Store User Data Policy, incluindo os requisitos de Limited Use.

## Privacidade de crianças

O Smart Preload não é direcionado a crianças e não coleta intencionalmente informações pessoais de crianças.

## Alterações

Esta política pode ser atualizada quando o Smart Preload alterar seu comportamento de tratamento de dados. A versão mais recente será publicada neste repositório.

## Contato

Para dúvidas sobre privacidade: biocanse@gmail.com
