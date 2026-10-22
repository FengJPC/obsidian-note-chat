# 数据与隐私 / Data and privacy

伴读侧栏 0.3.0。独立第三方项目，作者 FengJPC。

## 保存与传输

每个 Obsidian 笔记库独立保存本插件的对话、上下文、尚未发送草稿、用户提供的附件、生成文件、模型和界面设置。聊天、上下文、附件和快照位于库的 `.obsidian/plugins/note-chat-sidebar/chat-storage/`，设置和诊断位于同目录 `data.json`，是普通 JSON，不是系统加密的机密库。其他有权限访问笔记库的软件、插件或同步服务可能读取它。

账号身份、访问/刷新/身份令牌单独存入库外的本机凭据文件，并使用系统加密。Windows 为 `%LOCALAPPDATA%/NoteChatObsidian/`，优先可用的 Electron safeStorage，否则 Windows 当前用户 DPAPI。凭据按笔记库路径区分，安装的 host ID 为本机应用的随机标识。没有可用的系统加密时不写明文令牌。加密不能防止已控制当前用户会话的恶意软件。

不含令牌的应用登记（client ID、账号身份、邮箱/显示名称）以本机 JSON 文件保存在同一授权目录的 `registrations/`，供本机不同库复用；各库选择记录也在库外。登记元数据没有系统加密，其他有本机文件访问权限的软件可以读取；访问/刷新/身份令牌仍按库独立加密保存，不在这些 JSON 中，也不写入笔记库。

登录在系统浏览器访问 OpenAI 授权页面；本机临时 HTTP 回调仅绑定 `127.0.0.1` 随机端口，验证 state、PKCE 和身份签名。监听器在登录结束、取消、超时或插件卸载后关闭。插件不索取或保存 ChatGPT 密码，不读取浏览器 Cookie、Codex 凭据或其他插件的授权。

发送消息时，当前对话上下文及用户主动提供、点击添加或明确要求读取的资料会发送到 `https://api.openai.com/v1/responses`。账号登录/刷新和身份签名验证访问 `https://auth.openai.com`。模型目录访问官方 API。请求不自动重试，使用 `store:false`，但 OpenAI 自身的数据处理仍受其政策约束。

普通聊天不会读取当前笔记或扫描整个库。明确读当前笔记时，只读取目标 Markdown 的当前编辑内容/文件；当前目标为 PDF 时按明确操作在本机读取并提取该 PDF 的文本；主动附加的材料可包含笔记路径、库名、文本、图片或 PDF 文字。上传 PDF 在本机解析，无 OCR，不执行文件内容。最多 3 份资料、单份 20 MB，文本截断到 120000 字符。

对话或生成文件只有在点击保存/附件时写入配置的库内导出目录。同名文件自动改名，不覆盖笔记。Markdown 导出不含登录令牌，不完整嵌入图片/附件，不恢复会话状态。

项目没有自有服务器、遥测、广告或数据出售。模型没有操作系统命令、自动改写/删除笔记或跨库读取工具。点击外部链接会打开默认浏览器，目标网站适用自己的政策。

## 联网资料与诊断

联网默认关闭。开启后，搜索查询及相关对话上下文由 OpenAI 服务处理；搜索结果和引用会保存到当前对话。增强公共读取另有开关，启用后由本机匿名访问模型选择的公共 HTTPS 网站，网站能看到请求的网络地址。下载不携带账号令牌、站点 Cookie 或 Referer，不读取其他应用的登录资料。

直接读取会检验系统 DNS 的实际地址并固定到本次连接，拒绝内网、回环和保留地址，不自动跟随跳转。仅当系统 DNS 返回 198.18.0.0/15 代理映射地址时，插件通过固定的 Cloudflare DNS-over-HTTPS 端点解析目标域名的 IPv4 地址。Cloudflare 会看到域名和网络地址，不接收完整 URL、笔记、聊天或账号凭据。解析失败不放宽检查。实现参照 [Cloudflare JSON DNS 文档](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/)。

正文快照每个对话最多 8 份/480000 字符，保存在本库 chat-storage/ 的对应对话文件；查找和分段读取产生的内容也可能作为工具结果进入已发送上下文。清空快照不清除历史上下文；删除对话才会移除该对话的本地聊天与快照。

诊断默认在联网时记录，保留最近最多 50 次请求/2 MB，和历史一样存于本库 data.json，可能被笔记库同步工具同步。记录经过筛选的查询、网址、实际可见的状态、长度、时间与错误摘要，不主动保存完整正文、附件、请求头或令牌。导出再次脱敏，但网址和查询仍可能含私人内容。设置中可关闭记录、导出或清空诊断。

## 清除、同步和更新

历史可以在侧栏删除。断开清除本库的加密登录令牌文件，保留不含令牌的登记与账号选择供后续复用，但不会撤销 OpenAI 服务端的应用授权；请在 ChatGPT 设置撤销。导出文件需在笔记库自行管理。
删除插件 data.json 和 chat-storage/ 可清除本库历史、设置和升级备份；请先备份需要的数据。旧聊天迁移时保留 chat-storage/legacy-backup.json，删除当前会话不会自动修改该备份，确认迁移完整后可自行删除备份。卸载不会自动删除普通目录内的导出笔记或所有库外授权文件。
我们不提供跨库或云同步，但用户配置的笔记库同步/备份软件可能同步 data.json、chat-storage/（含升级备份）和导出笔记。迁移设备、移动库路径后需要重新登录。

English: Chats, drafts and attachments are stored as separate files in each vault's plugin chat-storage/ directory; preferences remain in data.json. Migration retains a legacy-backup.json that may contain subsequently deleted conversations until the backup is removed. OAuth tokens are protected by local system encryption outside the vault and never exported with Markdown. Only user-submitted or explicitly requested material is sent to OpenAI. No publisher backend, telemetry, advertising, automatic vault-wide scanning or command execution is provided. Third-party vault sync tools may copy chat data. Non-secret client registrations and vault-specific selections are kept as local JSON outside the vault, shared on this device for registration reuse. Tokens stay separately encrypted per vault and are never shared across vaults. Disconnect clears this vault's local tokens while preserving registration metadata; revoke server-side access in ChatGPT settings.
