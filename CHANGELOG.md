# Changelog

## [1.0.1](https://github.com/xsyk/AionUi/releases/tag/v1.0.1) (2026-10-10)

Models, agents and the image generation model are now configured once by the administrator and shared by every user. Work and log directories default to /data/.AionEasiful, and the sign-in page puts Feishu first.

### Desktop

#### Features

- **web-cli:** default work and log dirs to /data/.AionEasiful, chosen at install
- **settings:** show shared models read-only to non-admin users
- **settings:** show shared agents read-only to non-admin users
- **tools:** make the image generation model a shared setting
- **image:** support the OpenAI Images API for gpt-image and dall-e models
- **settings:** show server directories read-only in the web UI
- **login:** Feishu-first sign-in page with password and redirect views

#### Bug Fixes

- **web-cli:** never treat an unreadable install record as missing
- **settings:** stop listing gpt-image and dall-e as unsupported image models
- **tools:** surface load errors and stale image generation choices
- **image:** only accept real image bytes from downloaded URLs
- **web-cli:** load the shipped image generation MCP script as CommonJS
- **login:** address review of the sign-in page

### Core ([v1.0.1](https://github.com/xsyk/AionCore/releases/tag/v1.0.1))

#### Features

- **auth:** add a guard for shared configuration writes
- **provider:** share model providers across all users
- **provider:** only the administrator changes shared providers
- **agent:** share custom agents and gate agent settings to the administrator
- **settings:** store the image generation model as a shared setting
- **conversation:** inject the shared image generation MCP into every session
- **workspace:** keep recognizing temp workspaces under the previous root
- notify Feishu of final conversation errors with agent identity

#### Bug Fixes

- **settings:** keep image generation off the session start path

## [1.0.0](https://github.com/xsyk/AionUi/releases/tag/v1.0.0) (2026-10-08)

First AionEasiful release: a self-hosted WebUI with multi-user login (super admin, user management, Feishu sign-in), the AionEasiful name and logo.

### Desktop

#### Features

- **admin:** user management and super-admin act-as for WebUI
- **admin:** Feishu login settings card and account source column
- **login:** sign in with Feishu
- **web-host:** AIONUI_IDENTITY_MODE=webui starts aioncore without --local
- **login:** feishu signup approval, pending tag and site-URL start
- **admin:** show email and avatar in the user list
- **settings:** remove the About page
- remove the feedback dialog, its entry points and the GitHub star button
- show the product as AionEasiful
- use the AionEasiful logo and favicon
- **conversation:** hide stored newer-CLI version notices
- **workspace:** create a folder from the server folder picker

#### Bug Fixes

- **auth:** load full profile after login and reset state on logout
- **admin:** keep the super admin's own conversation list out of act-as
- **admin:** save Feishu login settings without opening Advanced
- **admin:** the Feishu authorization URL setting no longer covers the token call
- address review of the AionEasiful changes

### Core ([v1.0.0](https://github.com/xsyk/AionCore/releases/tag/v1.0.0))

#### Features

- **acp:** add MiniMax Code as a builtin Registry npx agent
- **auth:** add --disable-csrf / AIONUI_DISABLE_CSRF to skip CSRF in non-local modes
- **auth:** super-admin user management, act-as and soft delete
- **db:** feishu login config table and external local users
- **auth:** sign in with Feishu (OAuth) in webui mode
- **db:** feishu signup policy column and disabled external users
- **auth:** feishu login uses PKCE
- **auth:** feishu signup approval and site URL in login status
- **file:** create a folder through POST /api/fs/mkdir
- **session:** stop reporting CLI installs newer than the verified release
- **assistant:** call the product AionEasiful in built-in assistants
- **auth:** show AionEasiful on the QR login page

#### Bug Fixes

- **deps:** record reqwest for aionui-auth in Cargo.lock
- **auth:** address review of feishu multi-server login
- **auth:** exchange PKCE feishu codes at the v2 token endpoint
