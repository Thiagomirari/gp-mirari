# Checklist de homologacao antes de producao

- [ ] Confirmar que a Versao 02 original nao foi alterada por hash SHA-256.
- [ ] Criar projeto Supabase de homologacao, nunca usar producao no primeiro teste.
- [ ] Aplicar as migracoes na ordem documentada e revisar o resultado de cada `begin/commit`.
- [ ] Criar uma organizacao e executar bootstrap de owner usando somente a Edge Function.
- [ ] Verificar RLS com dois usuarios de organizacoes diferentes e confirmar isolamento total.
- [ ] Verificar que usuario sales nao le nem grava custos.
- [ ] Verificar que anon nao acessa tabelas, objetos de Storage ou arquivos de proposta.
- [ ] Testar produto ativo, arquivado, preco, custo e versao.
- [ ] Testar proposta com item, desconto, imposto, parcelas, envio e nova versao.
- [ ] Confirmar que versao enviada nao pode ser modificada por SQL/RPC/interface.
- [ ] Testar PDF, Storage privado e URL assinada com expiracao.
- [ ] Testar proposta aceita e comando idempotente de criacao de projeto em ambiente de homologacao.
- [ ] Reconciliar totais e amostras importadas antes de ativar feature flag de qualquer organizacao.
- [ ] Fazer backup do banco e exportar `gp_app_settings` antes do piloto de producao.
