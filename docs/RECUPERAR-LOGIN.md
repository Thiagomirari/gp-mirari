# Recuperar acesso quando a senha antiga nao funciona

O login de producao usa o Supabase Auth. A senha que existia somente no cadastro legado do sistema nao e automaticamente uma senha do Auth.

## Para usuario e senha

1. No Supabase, abra **Authentication > Users**.
2. Localize o usuario pelo e-mail usado no Auth. Para usuarios cadastrados apenas como `ADM`, `daniel`, `lais` ou `montagem`, o e-mail convencional usado pelo sistema e `adm@gp-mirari.local`, `daniel@gp-mirari.local`, `lais@gp-mirari.local` ou `montagem@gp-mirari.local`.
3. Confirme o usuario e defina uma nova senha temporaria.
4. No GP Mirari, use o nome de usuario original e essa nova senha.
5. Se o usuario nao existir no Auth, ele precisa ser criado pela Edge Function `gp-admin-users` por um `owner`/`admin` ativo, ou provisionado controladamente pelo administrador do Supabase.

## Se o usuario administrador nao consegue entrar

O primeiro `owner` precisa ser criado no Supabase Auth e associado a uma organizacao relacional antes de usar a tela administrativa. Nao habilite `demoMode` em producao e nao coloque `service_role` no navegador.

## Se ainda falhar

Verifique se o servidor publicou juntos `index.html`, `supabase-config.js` e o bundle atualizado do Supabase. A mensagem deve indicar se o problema e usuario inexistente, senha incorreta ou configuracao do serviço.
