# Agent Note: dsh-waimao 把状态存在 DSH home 之外

Status: proposed

[English](2026-11-16-waimao-global-config-path.md) | 中文

## Problem

`dsh-waimao` 把所有持久状态放在 `WAIMAO_DIR` 下，该常量由 `dsh/config.js` 解析：

```js
export const WAIMAO_DIR = process.env.WAIMAO_HOME
  ? join(process.env.WAIMAO_HOME)
  : join(homedir(), '.waimao');
```

该包从不读取 profile 名称、`DSH_PROFILE` 或 `profileContext`，其 README 也把
`~/.waimao/config.json` 列为配置文件
（[package](../../../../.dsh/profiles/web/node_modules/dsh-waimao/README.md)）。

因此默认位置在 `$DSH_HOME` **旁边**，而不在其内部：

| 路径 | 归属 |
| --- | --- |
| `~/.dsh/profiles/<name>/` | 单个 DSH profile、其 bundle、清单和 patch 层 |
| `~/.dsh/profiles/<name>/settings.yaml` | 该 profile 的用户设置 |
| `~/.waimao/` | 本机上每一个 `dsh-waimao` 实例 |

插件持久化的所有内容都共享这一个全局目录：`config.json`、
`data/audit.jsonl`、`data/templates.json`、`data/kb.json`、`data/warmup.json`、
`data/monitor.json` 以及邮箱验证缓存。`DATA_DIR` 由同一常量派生，所以 CRM、
审计日志和抑制列表同样是全局的。

第二个 DSH home、第二个 profile，或同一 OS 账号的第二个机器用户，都会读写同一份
通讯录、同一组 SMTP 凭据、同一份审计日志和同一个抑制列表。两个人推动同一条线索过
pipeline，或一个 profile 的 `dryRun` 总闸覆盖另一个 profile 的真实发信，都直接来自
这个共享路径。

`WAIMAO_HOME` 是唯一的逃生口，部署必须为每个 profile 进程单独设置它才能恢复隔离。
profile bundle 中没有任何地方设置它，所以默认就是共享目录。

该插件作为 `web` profile 的 bundle 层安装，而同一账号上的其他 profile 和其他 DSH
home 并不共享它。矛盾在于：安装是按 profile 的，状态根却是按机器的。

## Proposal

在第二个 profile 或第二个 DSH home 使用该插件之前，把共享根当作阻塞项，并在上游修复
默认值：`dsh-waimao` 从当前 profile 派生 `WAIMAO_DIR`，例如
`join(resolveDshHome(), 'waimao', profileName)`，并保留 `WAIMAO_HOME` 作为显式
覆盖。这是唯一能让默认值对所有使用者都正确的方案，且属于包作者，因为该路径是包自己的
状态契约。

在该包改变之前，需要隔离的部署应把 `WAIMAO_HOME` 显式设为 profile 本地路径，并把现有
的 `~/.waimao` 内容一次性复制进去。`cordis.patch.yml` 的条目可以在插件读取
`config.js` 之前设置该变量，因此隔离部署无需 fork。

## Alternatives considered

- **只在 profile patch 层设置 `WAIMAO_HOME` 就收工。** 这样无需 fork 即可隔离部署，
  也会让每个 profile 指向自己的 CRM，但它仍要移动 `~/.waimao` 中已有的数据，因此需要
  一次性复制步骤，且不能悄悄采纳。
- **用 rebrand 脚本改写常量。** `scripts/apply-*-rebrand.mjs` 系列已经在修补已安装的
  包。照做会把 profile 相对路径硬编码进每次更新都会被覆盖的第三方代码，而且脚本必须在
  安装时就知道 profile 名。
- **接受共享目录。** 这保持包不变，却让一台机器上的两个 profile 悄悄共享凭据、CRM 和
  审计状态，而这正是本记录要报告的问题。

## Acceptance criteria

- 未设置 `WAIMAO_HOME` 时，`WAIMAO_DIR`、`CONFIG_PATH` 和 `DATA_DIR` 解析到当前
  profile 的 home 下。
- 同一 DSH home 的两个 profile，以及同一 OS 账号的两个 DSH home，各自保有独立的配置、
  CRM、审计和模板状态。
- `WAIMAO_HOME` 仍可覆盖默认值，使该包的 e2e 隔离继续有效。

## Risks

改变默认值会在升级时移动每个现有用户的数据：已经写入 `~/.waimao` 的 profile 若不先做
迁移，就会从一个空状态开始。猜错的迁移会丢掉正在使用的 CRM，所以复制步骤必须显式且可
回滚。覆盖变量也必须继续生效，因为该包自己的 e2e 套件用 `WAIMAO_HOME` 重定位目录，
无条件解析 profile 的修复会破坏它。
