# Arquitetura implementada na candidata

## Limite da entrega

Esta entrega preserva a Versao 02 como fonte e cria uma candidata local separada. Nenhum SQL, Edge Function ou arquivo foi publicado. A camada de tela usa dados locais apenas para homologar a experiencia, e o adaptador esta isolado para posterior troca para Supabase.

## Dados e multitenancy

Toda tabela nova usa `organization_id`. A Etapa 1 fornece os objetos de Produto e Proposta. As migracoes seguintes acrescentam identidade, CRM normalizado, auditoria e Storage. O CRM e Projeto atuais continuam no JSON ate existir uma migracao assistida: por isso `opportunity_ref` e `project_ref` sao textos, nunca chaves estrangeiras para o estado legado.

## Identidade e RLS

`gp_v2_memberships.user_id` referencia `auth.users.id`; nao depende de `gp_profiles`. As funcoes `gp_v2_is_active_member` e `gp_v2_has_role` centralizam a verificacao de tenant. Todo acesso anonimo e revogado, todas as tabelas novas usam RLS e custos sao restritos a `owner` e `admin`.

O bootstrap de owner e a administracao de memberships usam a Edge Function `gp-v2-saas`, apos validar o token do usuario. A service role permanece exclusivamente no ambiente Edge e nunca e exposta ao navegador.

## Produtos

Produto e versao sao entidades distintas: o produto guarda identidade comercial, e a versao guarda escopo, impostos e atributos versionados. Tabelas de preco, custos e imagens sao independentes. Imagens armazenam apenas paths privados do Storage. O modulo de tela apresenta catalogo, filtro, cadastro e arquivamento, sem tocar nos produtos atuais porque eles ainda nao existem no banco normalizado.

## Propostas

Uma proposta e o envelope comercial; cada versao guarda snapshots de cliente, escopo, condicoes, totais e itens. Itens preservam codigo, nome, descricao, unidade, imagem, preco, desconto e imposto. A candidata calcula valores em centavos na interface para evitar erros de ponto flutuante; o banco preserva todos os valores como `numeric`.

Ao enviar, aprovar, aceitar, recusar ou expirar, a versao e bloqueada. Ajustes posteriores exigem nova versao. A candidata tambem registra evento por proposta e apresenta a acao Criar proposta no detalhe de oportunidade CRM.

## PDF e arquivos

`gp-v2-proposal-pdf` foi preparado como Edge Function que gera PDF simples com identidade Mirari, tabela de itens, totais e condicoes. O resultado vai para bucket privado em caminho `organization_id/proposals/...`; o banco guarda somente esse caminho. A funcao deve ser publicada somente depois das politicas de Storage privadas e nao envia links publicos.

## Conversao CRM, proposta e projeto

O fluxo definitivo sera: oportunidade normalizada -> proposta criada -> proposta aceita -> projeto criado por comando idempotente. Enquanto CRM e Projetos estiverem no JSON, a candidata nao altera a regra atual de negocio e usa somente a referencia textual da oportunidade. A criacao de projeto deve continuar vinculada ao fechamento existente ate a migracao assistida e reconciliada.

## Riscos controlados

- `gp_profiles` pode divergir de Auth. A fundacao nao presume essa tabela; a Etapa 2 usa `auth.users.id` diretamente.
- O JSON atual contem IDs legados e valores em texto. Nao ha conversao automatica nesta candidata.
- As Edge Functions requerem URLs permitidas em CORS e secrets configurados no ambiente Supabase.
- O PDF de producao precisa de homologacao de fonte, pagina, caracteres especiais e upload antes de uso comercial.

## Rollback

Como todas as migracoes sao aditivas, o rollback recomendado e desabilitar as feature flags e interromper o uso das novas tabelas. Em homologacao, remova somente as tabelas/politicas/buckets criados pela respectiva migracao, em ordem inversa, apos exportar registros. Nunca apague tabelas legadas ou `gp_app_settings`.
