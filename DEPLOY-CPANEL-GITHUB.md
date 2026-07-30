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
- Confirmar se os dados continuam salvos no Supabase.
