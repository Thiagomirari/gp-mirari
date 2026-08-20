# Contexto Atual GP Mirari

Atualizado em: 2026-08-03

## Checkpoint Oficial - 2026-08-03

Este checkpoint registra o estado confirmado do GP Mirari ate o commit atual. Ele serve como ponto seguro de retomada para as proximas evolucoes, sem alterar banco de dados, autenticacao, integracoes ou dados existentes.

Estado do repositorio:

```text
Versao oficial: outputs/gp-mirari-deploy
Branch: main
Commit: 6dcd42e - Configura tarefas obrigatorias no CRM
Repositorio: https://github.com/Thiagomirari/gp-mirari
```

Validacoes confirmadas:

- `tests/validate-release.mjs` aprovado.
- `tests/finance.test.mjs` aprovado.
- Diretorio Git limpo apos o commit.
- Nenhum SQL remoto executado neste checkpoint.
- Nenhuma alteracao feita no banco, autenticacao ou configuracao de deploy.

Ultimo ciclo de arquivos alterados:

- `index.html`
- `tests/validate-release.mjs`

Estado funcional confirmado:

- CRM com funil comercial, oportunidades, etiquetas editaveis e historico.
- Clientes e propostas vinculadas as oportunidades.
- Tarefas comerciais separadas das tarefas de projetos.
- Criacao, edicao, conclusao e exclusao de tarefas comerciais.
- Tarefas automaticas configuraveis por etapa do funil.
- Tarefas automaticas obrigatorias bloqueiam o avanco de etapa ate a conclusao.
- Tarefas manuais nao bloqueiam o avanco de etapa.
- Modelos de tarefas podem ser configurados na area administrativa do CRM.
- Oportunidade, propostas, tarefas, chat e historico aparecem em secoes separadas.
- Projetos, calendario, Kanban, propostas e formacao de preco permanecem preservados.
- Persistencia compartilhada mantida via Supabase e `gp_app_settings/app_state`.

Pendencias e riscos para a proxima retomada:

- Validar visualmente o fluxo completo no navegador depois do deploy.
- Revisar login com Google, incluindo redirect URLs e controle de usuarios autorizados.
- Evoluir a base de clientes e especificadores.
- Concluir a edicao completa de oportunidades.
- Implementar versionamento interno de propostas.
- Implementar selecao de ambientes para PDF e formacao de preco.
- Revisar o desconto global em propostas.
- Avaliar a migracao futura do estado JSON para tabelas relacionais.

Proximo ponto recomendado:

1. Confirmar o deploy em `https://gp.mirari.com.br`.
2. Testar CRM, tarefas comerciais, propostas e permissao de usuarios.
3. Retomar as pendencias pelo arquivo `docs/REGISTRO-DE-ATUALIZACOES-FUTURAS.md`.

Este documento consolida o estado operacional do GP Mirari para facilitar retomadas futuras no Codex, reduzir dependencia do historico da conversa e preservar decisoes importantes do projeto.

## Fonte Principal

A versao atual de deploy esta em:

```text
outputs/gp-mirari-deploy
```

Arquivos principais:

```text
index.html
assets/saas-core.js
assets/saas-core.mjs
assets/saas-extension.js
assets/saas-theme.css
supabase-config.js
docs/REGISTRO-DE-ATUALIZACOES-FUTURAS.md
```

Repositorio Git local:

```text
C:\Users\GC Planejados\Documents\Codex\2026-07-14\pre\outputs\gp-mirari-deploy
```

Repositorio GitHub:

```text
https://github.com/Thiagomirari/gp-mirari
```

Branch principal:

```text
main
```

## Deploy

O deploy principal esta automatizado por GitHub Actions via FTPS.

Fluxo atual:

```text
Codex altera arquivos
Codex executa validacoes
Codex faz commit
Codex faz git push para main
GitHub Actions executa Deploy cPanel
Arquivos sao enviados via FTPS para o cPanel
Site atualiza em https://gp.mirari.com.br
```

Workflow:

```text
.github/workflows/deploy-cpanel.yml
```

Secrets configurados no GitHub:

```text
CPANEL_FTP_SERVER
CPANEL_FTP_USERNAME
CPANEL_FTP_PASSWORD
CPANEL_FTP_PORT
CPANEL_FTP_DIR
```

Configuracao conhecida:

```text
Servidor FTP/FTPS: ftp.mirari.com.br
Usuario: miraricom
Porta: 21
Protocolo: FTPS explicito
Destino: /gp.mirari.com.br/
```

O arquivo `.cpanel.yml` tambem existe como plano B para deploy manual pelo Git Version Control do cPanel.

Destino manual configurado:

```text
/home/miraricom/gp.mirari.com.br/
```

## Estado da Aplicacao

O GP Mirari evoluiu de uma ferramenta local para uma aplicacao SaaS simples hospedada em cPanel, com Supabase para persistencia compartilhada.

Modulos principais:

```text
CRM
Clientes
Projetos
Calendario
Kanban
Tarefas
Propostas
Administracao
```

O CRM e o modulo de propostas foram incorporados na versao atual de deploy.

## Supabase

Projeto Supabase:

```text
https://stoczbnzjowrygsxrylh.supabase.co
```

O estado compartilhado da aplicacao e salvo principalmente em:

```text
gp_app_settings / app_state
```

Pontos importantes:

- O estado historico do app ainda tem partes em JSON.
- O CRM atual ainda possui dados que nasceram em estrutura local/JSON.
- A base SaaS ainda deve evoluir gradualmente para tabelas relacionais dedicadas.
- Nao usar service role no navegador.
- Alteracoes de usuarios e autenticacao devem respeitar Supabase Auth e Edge Functions existentes.

## Autenticacao

Autenticacao atual baseada em Supabase.

Ja foram trabalhados:

- login por usuario/senha;
- preparacao/discussao de login Google;
- gestao de usuarios pelo sistema;
- alteracao de senha via fluxo autorizado.

Ponto pendente conhecido:

- Login com Google exigiu ajustes e pode precisar revisao futura de configuracao Supabase, providers, redirect URLs e liberacao por usuario.

## Regras Importantes de CRM

O CRM deve ser a primeira etapa comercial.

Regras e decisoes:

- Nova oportunidade pode criar cliente automaticamente.
- Deve existir base universal de clientes.
- Oportunidade deve poder selecionar cliente existente.
- Nome do cliente/oportunidade deve ser o minimo obrigatorio no inicio.
- Informacoes contratuais completas devem ser exigidas ao fechar venda, nao necessariamente no primeiro contato.
- Oportunidades devem manter historico de eventos.
- Propostas vinculadas a oportunidades devem aparecer no historico da oportunidade.
- Negocio fechado pode gerar projeto.
- Negocio perdido exige motivo.

Pendencias registradas:

- Editar melhor dados da oportunidade.
- Mostrar preco da proposta apresentada no CRM.
- Revisar filtros e indicadores comerciais conforme evolucao.

## Regras Importantes de Propostas

Nao ha necessidade de uma tela independente de produtos.

A proposta deve permitir lancamento manual de ambientes/produtos:

```text
Produto ou ambiente
Custo de producao
Quantidade
Markup
RT global
Desconto
Condicoes de pagamento
Validade
Observacoes
Vinculo com cliente/CRM
```

Ambientes podem ter subitens de composicao.

Regras de composicao:

- Subitens somam ao custo do ambiente.
- Subitem possui custo de compra/producao e markup proprio.
- RT e global da proposta, nao por subitem.
- Se ambiente possui subitens, o valor do ambiente deve ser calculado pela soma dos subitens e nao editado manualmente na tela principal.
- Se ambiente nao possui subitens, o valor do ambiente pode ser editado manualmente.

PDF da proposta:

- Mostrar apenas valores finais ao cliente.
- Nao expor markup, RT, custos internos ou composicao interna.
- A vista aparece como condicao especial.
- Condicoes de pagamento devem aparecer ordenadas do maior valor para o menor.
- Valor total do PDF deve usar a maior condicao selecionada.
- Texto deve usar "Condicoes de pagamento".

## Condicoes de Pagamento

Condicoes discutidas/implementadas:

```text
A vista
Parcelado cartao
Parcelado cartao com entrada
Parcelado loja
A vista com entrada
```

Regras principais:

- Repasse de taxa financeira deve usar:

```text
valor cobrado = valor liquido desejado / (1 - taxa%)
```

- Cartao deve considerar taxa fixa equivalente a 12x quando configurado assim.
- A vista deve representar o valor real, sem taxas financeiras.
- A vista com entrada tem desconto de 5% sobre o valor parcelado no cartao.
- A vista com entrada deve permitir entrada em valor e percentual.
- A vista com entrada deve permitir parcelas individuais com valor e percentual.
- Percentuais de entrada + parcelas devem fechar 100%.
- Parcelado loja pode ter juros configurados por parcela em Administracao.
- Parcelado loja pode ter entrada e juros apenas sobre saldo financiado.

## Formacao de Preco

Analise de precificacao considera:

```text
Valor de venda
Custo de compra/producao
Imposto
RT
Frete
Comissoes
Taxas financeiras
Custo de montagem
Compras adicionais
Margem de contribuicao
Pontuacao da venda
```

Regras discutidas:

- Imposto incide sobre venda total.
- Taxas financeiras devem ser calculadas conforme condicao selecionada.
- A formacao de preco deve exigir a selecao da condicao de pagamento analisada.
- O valor de venda deve ser o total calculado para essa condicao: a vista, a vista com entrada, cartao ou parcelado pela loja.
- Condicoes sem taxa financeira devem manter esse custo zerado; cartao e parcelamento devem considerar somente o custo financeiro correspondente.
- RT deve sair da venda liquida:

```text
venda liquida = venda total - imposto - taxas financeiras
RT = venda liquida * percentual_RT
venda liquida apos RT = venda liquida - RT
```

- Comissoes incidem sobre venda liquida apos RT.
- Montagem foi ajustada para seguir regra definida, com padrao de 10%.
- Frete foi definido inicialmente como 12%.
- Comissao do Thiago deve vir ativada por padrao.
- Relatorio deve apresentar venda liquida e venda liquida apos RT.
- Saude da proposta deve mostrar indicadores como RT, frete, montagem e compras adicionais.

Ponto de atencao:

- Sempre validar impacto visual e numerico entre tela principal da proposta, formacao de preco e PDF.

## Regras de Permissao

Usuarios ADM:

- podem liberar edicao manual de markup e descontos;
- podem aprovar propostas;
- podem configurar regras administrativas;
- podem alterar usuarios conforme fluxo autorizado.

Usuarios operacionais:

- devem conseguir criar/editar propostas dentro do permitido;
- nao devem ver botao administrativo de liberacao de markup/desconto;
- devem ter limite de desconto padrao;
- nao devem acessar acoes administrativas restritas.

Regra ja solicitada:

- Botao ADM nao deve aparecer para usuarios operacionais.

## Projetos e Operacao

Projetos possuem etapas, tarefas, checklists, calendario e Kanban.

Regras importantes:

- Etapas principais sao configuraveis.
- Subetapas funcionam como checklist e gatilhos.
- Avanco deve registrar usuario e historico.
- Retorno de etapa deve ser controlado por ADM, com motivo obrigatorio.
- Clicar em etapa no trilho deve visualizar, nao alterar diretamente.
- Historico do projeto deve abrir separado, nao poluir tela principal.

## Registro GP

Arquivo para pendencias futuras:

```text
docs/REGISTRO-DE-ATUALIZACOES-FUTURAS.md
```

Use este arquivo para registrar melhorias que nao devem ser executadas imediatamente.

## Validacoes Antes de Push

Antes de enviar alteracoes para o GitHub, preferir executar:

```text
node tests/finance.test.mjs
node tests/validate-release.mjs
node --check assets/saas-extension.js
node --check assets/saas-core.js
node --check assets/saas-core.mjs
```

Se algum teste nao puder ser executado, registrar no resumo final.

## Cuidados de Deploy

Nao commitar:

```text
backups/
*.zip
```

Nao publicar no FTPS:

```text
.git
.github
backups
functions
migrations
supabase
tests
*.zip
.cpanel.yml
package.json
supabase-config.example.js
```

O workflow atual ja exclui esses caminhos.

## Decisoes Tecnicas Relevantes

- Manter funcionalidade atual antes de grandes reestruturacoes visuais.
- Preferir alteracoes incrementais.
- Preservar banco, autenticacao, regras e estado existente.
- Nao expor custos internos em PDF de cliente.
- Usar GitHub Actions como deploy principal.
- Usar cPanel Git Deployment apenas como fallback.
- Centralizar contexto neste documento para reduzir dependencia do historico da conversa.

## Proximo Padrao de Trabalho

Para futuras alteracoes:

1. Ler este documento.
2. Consultar `REGISTRO-DE-ATUALIZACOES-FUTURAS.md` se a tarefa vier de pendencia registrada.
3. Verificar estado Git.
4. Implementar com escopo controlado.
5. Rodar validacoes.
6. Commitar com mensagem clara.
7. Fazer push.
8. Conferir GitHub Actions.
9. Informar ao usuario o que mudou, como testar e se o deploy automatico concluiu.
