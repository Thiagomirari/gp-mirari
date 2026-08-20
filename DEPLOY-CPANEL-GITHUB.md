# Publicacao com GitHub + cPanel

## Objetivo

Usar o GitHub como fonte oficial dos arquivos do GP Mirari e atualizar o cPanel sem enviar arquivos manualmente a cada versao.

## Primeira Publicacao

1. Crie um repositorio no GitHub chamado, por exemplo:

```text
gp-mirari
```

2. Envie o conteudo desta pasta para o repositorio.

3. No cPanel, abra:

```text
Git Version Control
```

4. Crie um clone do repositorio na pasta do subdominio, por exemplo:

```text
public_html/gp
```

ou na pasta definida pelo seu subdominio:

```text
gp.mirari.com.br
```

5. Confirme que o arquivo `index.html` ficou na raiz publica do subdominio.

## Atualizacoes Futuras

Depois que o GitHub estiver configurado, o fluxo ideal sera:

1. Alteramos os arquivos no Codex.
2. Enviamos a versao nova para o GitHub.
3. No cPanel, usamos `Pull` ou `Update from Remote`.
4. A nova versao entra no ar.

## Validacao automatica

O deploy por GitHub Actions executa `npm run verify` antes de transferir qualquer arquivo. O comando roda toda a suite de testes e as checagens de sintaxe.

Opcionalmente, configure o secret `CPANEL_APP_URL` com a URL publica do sistema para que o workflow execute um teste de disponibilidade apos o deploy.

## Configuracao do Supabase

O arquivo `supabase-config.js` precisa existir no servidor.

Modelo:

```js
window.GP_MIRARI_SUPABASE = {
  url: "https://SEU-PROJETO.supabase.co",
  anonKey: "SUA_ANON_PUBLIC_KEY"
};
```

Use somente a chave `anon public`.

Nunca use `service_role` no navegador.

## Compartilhamento seguro de relatorios

Antes de publicar o botao **Gerar link** pela primeira vez:

1. Aplique `migrations/021-secure-report-sharing.sql` no projeto Supabase.
2. Opcionalmente, cadastre um segredo exclusivo e aleatorio de pelo menos 32 caracteres. Se ele nao existir, a funcao reutiliza `SIGNATURE_TOKEN_PEPPER` com separacao criptografica de dominio:

```bash
supabase secrets set REPORT_SHARE_TOKEN_PEPPER="VALOR_ALEATORIO_FORTE"
supabase secrets set REPORT_SHARE_PUBLIC_URL="https://gp.mirari.com.br/relatorio.html"
```

3. Confirme que `GP_APP_ORGANIZATION_ID` ja esta configurado para a organizacao do GP Mirari.
4. Publique a funcao publica. A verificacao JWT do gateway precisa ficar desligada porque a leitura externa usa token opaco; criacao, listagem e revogacao validam o JWT do usuario dentro da funcao:

```bash
supabase functions deploy gp-v2-report-share --no-verify-jwt
```

O valor de `REPORT_SHARE_TOKEN_PEPPER` e a chave secreta/service role ficam somente nos secrets do Supabase. Nunca os inclua nos arquivos do site ou no GitHub.

## Comandos Uteis

Quando o Git estiver instalado localmente:

```bash
git status
git add .
git commit -m "Atualiza GP Mirari"
git push
```

No cPanel, use a interface de Git para puxar a nova versao.

## Checklist Apos Atualizar

- Abrir o dominio em aba anonima.
- Confirmar login.
- Abrir CRM.
- Abrir uma proposta.
- Conferir pagamento.
- Abrir formacao de preco.
- Gerar PDF de proposta.
- Em Relatorios, gerar um link com validade de 1 dia e abri-lo em aba anonima.
- Revogar o link e confirmar que a pagina publica deixa de carregar.
- Confirmar se os dados continuam salvos no Supabase.
