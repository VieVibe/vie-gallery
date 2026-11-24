# 临时私人空间

用途：为 `rong@vie.com` 保存约 19 GB 婚纱照，临时使用到 2026 年底。入口是 `/app/private-space`，复用现有登录。只有配置中绑定的固定用户 ID 有权访问；邮箱相同、其他工作区成员或知道入口地址均不会获得权限。

## 原件保存约定

- 上传请求直接发送 `File` 的原始二进制数据，不使用 Canvas、图片重编码、降分辨率、去 EXIF 或改变色彩空间的处理。
- CR3、XMP、JPG/JPEG、PNG、TIF/TIFF、PSD 均作为普通文件保存。保留相对目录、文件名、大小写和文件内容；XMP 不解析重写。
- 浏览器按 2 MB 分块计算本地 SHA-256。客户端只能向 `staging/` 写入；服务器复制到没有上传授权的 `originals/`，将最终对象完整读回，比对字节数和 SHA-256。只有一致时才将记录置为 READY。
- 同名同内容再次上传幂等返回已有文件；同名不同内容拒绝覆盖。失败的上传不出现在文件列表中，重试使用新的对象键。没有删除或自动到期清理原件的接口。
- JPG/PNG 的预览是 `previews/` 下的独立派生文件，最长边 1280 像素。预览可能有方向或色彩显示差异，不能用于判断原件精度。原件始终保持原字节；CR3/XMP/TIFF/PSD 第一版只提供原件下载。
- 单文件下载在浏览器比对 SHA-256 和大小之后才提交保存；支持文件写入 API 的浏览器使用流式临时写入，失败时 abort。其他浏览器校验通过后才提供 Blob 下载。
- 批量下载由服务器流式生成无损 ZIP，逐文件重新校验并附 `__integrity_<UUID>.json` 清单。发现不一致时中止 ZIP，不返回正常结束的压缩包。浏览器下载完成后可运行下方校验脚本；服务器校验不能替代下载落盘后的校验。
- CR3 下载和批量选择自动包含同目录下已上传的同名 XMP。没有上传的 XMP 无法自动补齐。
- 上传后照片精度与源文件一致，但云服务故障、账号误操作等风险仍需独立备份覆盖。保留本地原件或移动硬盘副本；上传核验完成前保留百度网盘中的源文件。

## 部署与专用账号

2026-10-24 已完成线上启用，入口为 <https://gallery.vie-vibe.cn/app/private-space>。配置模板仍默认关闭，避免其他环境意外启用。

2026-10-24 已在现有线上服务创建并验证专用账号 `rong@vie.com`，固定用户 ID 为 `a40da344-aca7-4ade-8506-70ec37adf62f`。密码不记录在仓库。启用这次临时空间时应绑定此 ID。

独立桶 `vie-wedding` 已实测确认为西南1（成都）地域、私有 ACL，没有公开 Bucket Policy 或自动删除生命周期规则。服务器沿用已有 OSS 凭据访问新桶；凭据保留在服务器私密环境文件中，未复制到本机或仓库。

本机已生成专用 SSH 密钥并安装公钥，`ssh vie-gallery` 可免密连接 `ubuntu@43.130.250.22`。已有远端授权密钥保留。新桶 CORS 已配置为仅允许 `https://gallery.vie-vibe.cn` 的 PUT/GET/HEAD 请求；可信来源预检通过，不可信来源返回 403。

后端已发布并通过健康检查，Flyway V18 已在生产数据库成功执行。页面发布时先复制资源、最后原子替换入口，保留旧资源。数据库、环境文件、旧页面与镜像的回滚备份位于服务器 `/home/ubuntu/vie-gallery/.private-space/backups/wedding-20261024-1489f69a/`。本次发布使用工作区构建产物；后续通过仓库流水线发布时需包含本次代码改动。

线上后端镜像：`vie-gallery-api:wedding-20261024-downloadfix`（同时标记为 `latest`）。JAR SHA-256 为 `8abfc8c87a1295745b0a6d99e2f67fca76313d1fd606fbbcab0b6a17dda8d7b5`，页面入口 SHA-256 为 `cdf5e770769a6ce20b1d39dca6ac9d5f1a15dc0d70a951ffbdb85d336c9d1efb`。

1. 创建专用账号。使用提供的脚本，密码只在内存中处理，不写入源文件、配置模板或输出：

   ```powershell
   ./scripts/new-private-space-account.ps1 -BaseUrl https://gallery.vie-vibe.cn
   ```

   脚本固定注册 `rong@vie.com`；重试时只尝试用输入的密码登录，不会重置已有账号。记录返回的 `PRIVATE_SPACE_USER_ID`。不要用仅邮箱授权，也不要把密码写进环境文件。若已有不属于你的同名账号，停止启用并处理账号归属。

2. 使用已创建的 **`vie-wedding` 独立私有 OSS 桶**，确认实际地域并使用对应端点；开启阻止公共访问，确认没有公开 Bucket Policy。建议保留版本和本地独立备份。限制 RAM 凭证只访问这个桶；禁止公开列举或读取。

3. 配置 CORS：允许实际站点的 HTTPS Origin（例如 `https://gallery.vie-vibe.cn`）；方法 `PUT`、`GET`、`HEAD`；允许请求头 `Content-Type`、`x-oss-object-acl`、`Cache-Control`、`Pragma`。下载通过浏览器 fetch 校验，需要 GET 的 CORS。不要配置任意来源 `*`。

4. 将以下配置加入服务器私密环境文件，保留原有配置。生产 Compose 已通过 `env_file` 加载配置，无需重建现有存储。

   ```dotenv
   PRIVATE_SPACE_ENABLED=true
   PRIVATE_SPACE_USER_ID=a40da344-aca7-4ade-8506-70ec37adf62f
   PRIVATE_SPACE_OSS_ENDPOINT=https://oss-cn-chengdu.aliyuncs.com
   PRIVATE_SPACE_OSS_ACCESS_KEY_ID=<专用RAM凭证>
   PRIVATE_SPACE_OSS_ACCESS_KEY_SECRET=<专用RAM凭证>
   PRIVATE_SPACE_OSS_BUCKET=vie-wedding
   PRIVATE_SPACE_QUOTA_BYTES=34359738368
   PRIVATE_SPACE_MAX_FILE_BYTES=536870912
   ```

   上面的成都端点对应用户已确认的桶地域。默认容量 32 GiB、单文件 512 MiB，包含 RAW、XMP 和精修文件，不套用相册的图片像素限制。超过限制时拒绝上传，不做压缩。待完成上传会占用预留容量，重新选择同一批源文件即可继续；原件不支持自动覆盖。

5. 部署前后端，Flyway 执行 `V18__private_space.sql`。启动会检查专用用户 ID、HTTPS、独立桶和私有 ACL；错误配置会阻止功能启动。登录专用账号后自动进入私人空间，其他账号仍进入原有相册。

6. 在实际 OSS 上验收：上传 JPG、CR3 和对应 XMP，包含中文和多层目录；重选相同文件确认不重复；同名不同内容确认拒绝；用其他账号请求文件列表、上传、下载和导出均应拒绝；下载 ZIP 与本地原件核验后再迁移整批。这里的代码测试不替代实际云端验收。

OSS RAM 至少需要专用桶上的 `GetBucketAcl`，以及对应前缀的 `PutObject`、`GetObject`（CopyObject 需源读取和目标写入）；不需要给应用删除原件权限。临时对象清理可给 `staging/` 单独设置至少 2 天的生命周期；**绝不能给整个桶或 originals/ 设置到期删除规则**。失败校验产生的隔离原件会保留，排查后单独清理。

如果服务器是成都地域的阿里云 ECS，可额外设置 `PRIVATE_SPACE_OSS_INTERNAL_ENDPOINT=https://oss-cn-chengdu-internal.aliyuncs.com`，使服务器的回读校验、预览读取和打包读取走内网；浏览器上传下载仍使用公网地址。非同地域或非阿里云服务器保持该变量为空。公网回读也会产生 OSS 流出流量，且整包下载经过应用服务器会占用服务器带宽，应计入费用；存储费不是全部费用。

## 导出核验

浏览器下载完成后运行：

```powershell
./scripts/verify-private-space-export.ps1 -ArchivePath 'D:/备份/private-space-originals.zip'
```

同时与上传前的本地原件比较：

```powershell
./scripts/verify-private-space-export.ps1 -ArchivePath 'D:/备份/private-space-originals.zip' -SourceDirectory 'D:/上传源目录'
```

`SourceDirectory` 应对应压缩包内路径的根目录。例如上传文件夹 `婚纱照/原片/IMG_0001.CR3`，应指定包含“婚纱照”的上一级目录。脚本直接读取 ZIP 内文件做 SHA-256 校验，不需要解压或把整个包读入内存。清单仅说明这次导出的文件，首次整批迁移还应与本地总文件数、总大小比对，确认没有漏选或上传失败。

## 年底撤下

1. 下载全部原件，按清单核验，再与本地原件对比文件总数、总字节数和 SHA-256；保留至少两份独立备份。
2. 设置 `PRIVATE_SPACE_ENABLED=false` 并重新部署，关闭页面访问和全部接口。已签发的下载 URL 最多还有 15 分钟有效期，上传 URL 最多 1 小时且只能写 staging。
3. 确认备份可读取后，再人工清理独立桶、版本和数据库记录，撤销专用 RAM 凭证。停用功能不会自动删文件，也不会停止仍占用空间的 OSS 计费。
4. 后续可整体移除 `api/privatefiles`、`PrivateSpaceView.vue`、`lib/privateSpace*.ts` 及对应路由。已执行的 Flyway 迁移文件应保留；需要删表时另加迁移，不改写 V18。

## 本次验证范围

2026-10-24 完成前端单元测试、全项目类型检查与构建、Markdown 链接检查、后端现有测试及私人空间专用测试。新增完整性测试包括 SHA-256 的 512 MiB 长度边界、CR3 二进制和 XMP 内容、带 EXIF 的 JPG 原件保留、上传后临时链接复用不能改变原件、下载截断/超长/内容变化拦截、ZIP 逐文件校验与账号隔离。

浏览器验证包含私人空间 7 项场景，以及原有创作流程和工作区切换 31 项回归；检查了桌面和 390px 手机布局。PowerShell 导出工具验证了中文目录、CR3/XMP、损坏压缩包和本地原件不一致的拦截。

本机 Docker 集成测试未运行；已在真实生产 MySQL、Redis 和成都 OSS 上完成联调。真实云端 29 项检查通过，包括 JPG、CR3 二进制样例、带 BOM/中文/CRLF 的 XMP、原件回读和下载的大小/SHA-256、重复上传幂等、同名异内容拒绝、临时上传链接复用不能修改原件、损坏上传拦截、ZIP 逐文件及清单校验、未登录和其他账号拒绝访问。

真实站点浏览器另完成 6 项检查：专用账号登录跳转、浏览器直接上传 OSS、下载后字节与哈希一致、独立预览、390px 手机无横向溢出、退出登录。下载到本机的真实 ZIP 也通过 PowerShell 清单校验和跨服务器传输哈希核对。

联调发现 OSS 拒绝下载链接中的 `response-content-type` 参数（错误 `0017-00000902`），现已移除并补充回归测试；原件的 `application/octet-stream` 在上传时设置。参见[阿里云错误说明](https://help.aliyun.com/zh/oss/user-guide/0017-00000902)。

已按精确测试文件 ID、随机目录及原件哈希核对，清理本次 7 条测试文件记录、16 个测试对象及临时验收账号。清理后专用空间为 0 个文件，可开始上传实际婚纱照。验收使用测试样例，不代表百度网盘中的 19 GB 文件已经迁移；整批迁移后仍应核对总数量、总大小及校验值。
