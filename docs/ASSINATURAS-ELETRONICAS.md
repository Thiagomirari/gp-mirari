# Módulo de assinaturas eletrônicas — GP Mirari

## Diretriz jurídica e de produto

O provedor interno utiliza assinatura eletrônica com identificação do signatário, link individual, OTP por e-mail, manifestação expressa, hashes SHA-256 e trilha de evidências. Ele não declara validade jurídica automática e não se apresenta como assinatura qualificada ICP-Brasil.

ICP-Brasil, GOV.BR e provedores externos permanecem modalidades opcionais na camada de provedores para documentos que exijam outro nível de assinatura.

Referências principais:

- MP nº 2.200-2/2001, art. 10, § 2º: https://www.planalto.gov.br/ccivil_03/mpv/antigas_2001/2200-2.htm
- Lei nº 14.063/2020: https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2020/lei/l14063.htm
- CPC, art. 784: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13105.htm
- LGPD: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm

## Segredos obrigatórios no Supabase

Cadastrar em **Project Settings → Edge Functions → Secrets**:

- `SIGNATURE_INTERNAL_ENABLED=true`
- `SIGNATURE_APP_URL=https://gp.mirari.com.br/assinar.html`
- `SIGNATURE_VERIFICATION_URL=https://gp.mirari.com.br/verificar-assinatura.html`
- `SIGNATURE_TOKEN_PEPPER`: segredo aleatório exclusivo, com no mínimo 32 bytes
- `SIGNATURE_OTP_PEPPER`: outro segredo aleatório exclusivo, com no mínimo 32 bytes
- `SIGNATURE_DATA_PEPPER`: outro segredo aleatório exclusivo, com no mínimo 32 bytes
- `RESEND_API_KEY`: chave restrita ao envio de e-mails
- `SIGNATURE_FROM_EMAIL`: remetente de domínio verificado, por exemplo `GP Mirari <assinaturas@gp.mirari.com.br>`

Os três peppers devem ser diferentes, não podem ser incluídos no Git, em logs ou em respostas da API e precisam entrar na política de rotação controlada. A perda de um pepper pode impedir validações históricas; a rotação exige versionamento e plano de migração.

## Provedor de e-mail

A primeira versão usa Resend. Antes de ativar convites reais:

1. verificar o domínio de envio no Resend;
2. configurar SPF e DKIM indicados pelo provedor;
3. criar uma chave com o menor escopo possível;
4. cadastrar os segredos no Supabase;
5. testar entrega, spam, rejeição e indisponibilidade do provedor;
6. configurar alertas para falhas de entrega e limites do plano.

Documentação: https://resend.com/docs/knowledge-base/how-do-I-create-an-email-address-or-sender-in-resend

## Primeira configuração no sistema

1. acessar a aba **Documentos** com perfil Administrador;
2. abrir **Privacidade e retenção**;
3. inserir o aviso de privacidade revisado;
4. cadastrar uma política por tipo de documento utilizado;
5. informar base legal, finalidade e prazos aprovados;
6. confirmar a revisão jurídica ou do responsável por proteção de dados;
7. publicar a versão, que se torna imutável.

## Teste de aceite antes de uso real

Executar com endereços internos:

1. criar um PDF de teste;
2. cadastrar pessoa física;
3. validar link, CPF e OTP;
4. conferir documento, aviso e aceite não pré-marcado;
5. assinar e conferir a trilha;
6. repetir com duas pessoas e duas testemunhas opcionais;
7. testar recusa, expiração, reenvio e cancelamento;
8. baixar o PDF final e o relatório;
9. conferir os hashes no verificador público;
10. simular falha de finalização e usar **Retomar finalização**;
11. confirmar que todos recebem a mesma versão final.

## Operação e continuidade

- manter desenvolvimento e produção separados;
- testar restauração de backups periodicamente;
- monitorar eventos suspeitos, tentativas inválidas e falhas de e-mail;
- revisar políticas de retenção e bases legais com periodicidade;
- documentar incidentes de segurança e decisões de descarte;
- não apagar evidências sob obrigação legal, retenção aprovada ou exercício regular de direitos;
- submeter o desenho probatório e os modelos contratuais à validação jurídica antes de afirmar dispensa de testemunhas.
