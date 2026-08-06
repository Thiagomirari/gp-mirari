# Homologacao, seguranca e migracao relacional

## Status desta entrega

As migrations e Edge Functions foram preparadas no codigo local. Nenhuma migration, segredo, deploy ou alteracao de dados foi executada automaticamente no Supabase de producao.

O sistema legado ainda utiliza `gp_app_settings/app_state` para parte da interface. A migracao para as tabelas `gp_v2_*` deve ocorrer em fases; nao desative o estado legado ate que clientes, CRM, propostas e relatorios estejam lendo e gravando nas tabelas relacionais homologadas.

## Ordem obrigatoria em homologacao

1. Crie backup verificavel de `gp_app_settings`, Auth e Storage.
2. Aplique, na ordem: `001-v2-foundation.sql`, `002-identity-memberships-rls.sql`, `003-crm-normalization.sql`, `004-proposal-workflow-audit.sql`, `005-storage-private-documents.sql` e `006-reports-kpis-foundation.sql`.
3. Crie uma organizacao e o primeiro `owner` usando o fluxo administrativo controlado (`gp-v2-saas bootstrap_owner`), nunca por uma tela operacional.
4. Configure `GP_APP_ORGANIZATION_ID` nas funções `gp-admin-users`, `gp-v2-reports` e `gp-v2-proposal-pdf` com o UUID da organizacao homologada.
5. Configure `GP_ALLOWED_ORIGIN` com a origem publica exata (por exemplo, `https://gp.mirari.com.br`).
6. Publique as Edge Functions e valide primeiro com usuarios de teste.

## Testes minimos de aceite

- Um usuario `viewer` nao le custos, nao chama funcoes administrativas e nao acessa outra organizacao.
- Um usuario operacional nao pode elevar permissao pelo JSON legado nem editar memberships.
- Um `admin` nao consegue modificar, suspender ou remover um `owner`.
- O ultimo `owner` ativo nao pode ser suspenso ou removido.
- Uma proposta gera PDF, grava auditoria, retorna URL assinada temporaria e nao deixa arquivo orfao quando a gravacao falha.
- Os filtros de relatorio retornam os mesmos totais do banco para uma amostra conhecida.
- Dois usuarios editando entidades distintas nao sobrescrevem dados um do outro.

## Estrategia de migracao

1. Execute apenas em homologacao e carregue uma amostra anonimizada do estado legado.
2. Popule as tabelas relacionais por lote, preservando IDs legados em campos de referencia ou tabela de mapeamento.
3. Rode leitura paralela: a interface continua no legado, enquanto os relatorios comparam os totais relacionais e legados.
4. Migre um modulo por vez para escrita relacional transacional: catalogo, propostas, CRM, depois projetos e financeiro.
5. Desative a escrita do modulo correspondente no JSON somente depois de conciliacao, testes de isolamento por organizacao e aprovacao formal.

## Rollback

- Mantenha o recurso novo protegido por flag de ambiente/implantacao enquanto o piloto estiver aberto.
- Em falha, desative o caminho relacional da interface e retorne ao caminho legado; nao apague tabelas, buckets ou registros de auditoria.
- Restaure dados somente a partir do backup verificado e registre o incidente. Migrations aditivas nao devem ser revertidas com `DROP` em producao.
