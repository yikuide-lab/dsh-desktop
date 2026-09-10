# DSH Desktop Linux 安装指南

## 系统要求

- **操作系统**: Ubuntu 20.04+, Debian 11+, Fedora 36+, 或其他主流 Linux 发行版
- **架构**: x64 (amd64)
- **内存**: 建议 4GB+
- **磁盘空间**: 至少 2GB 可用空间

## 安装方式

### 方式一：AppImage（推荐）

AppImage 是最通用的格式，可以在大多数 Linux 发行版上运行。

1. 下载 `DSH-Desktop-*-x64.AppImage` 文件
2. 添加执行权限：
   ```bash
   chmod +x DSH-Desktop-*-x64.AppImage
   ```
3. 运行应用：
   ```bash
   ./DSH-Desktop-*-x64.AppImage
   ```

### 方式二：deb 包（Ubuntu/Debian）

1. 下载 `DSH-Desktop-*-amd64.deb` 文件
2. 安装：
   ```bash
   sudo dpkg -i DSH-Desktop-*-amd64.deb
   sudo apt-get install -f  # 修复依赖（如需要）
   ```
3. 从应用程序菜单启动 DSH Desktop

### 方式三：rpm 包（Fedora/RHEL）

1. 下载 `DSH-Desktop-*-x86_64.rpm` 文件
2. 安装：
   ```bash
   sudo rpm -i DSH-Desktop-*-x86_64.rpm
   # 或使用 dnf
   sudo dnf install DSH-Desktop-*-x86_64.rpm
   ```
3. 从应用程序菜单启动 DSH Desktop

## 从源码构建

### 前置条件

- Node.js 22.19+ 或 24+
- Corepack（Node.js 自带）
- Git
- 构建工具链：

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  clang \
  cmake \
  python3 \
  libgtk-3-dev \
  libnotify-dev \
  libnss3-dev \
  libxss-dev \
  libxtst-dev \
  libatspi2.0-dev \
  libuuid-dev \
  libsecret-1-dev

# Fedora
sudo dnf groupinstall -y "Development Tools"
sudo dnf install -y \
  clang \
  cmake \
  python3 \
  gtk3-devel \
  libnotify-devel \
  nss-devel \
  libXScrnSaver-devel \
  libXtst-devel \
  at-spi2-atk-devel \
  libuuid-devel \
  libsecret-devel
```

### 构建步骤

```bash
# 克隆仓库
git clone --recurse-submodules https://github.com/your-org/dsh-desktop.git
cd dsh-desktop

# 安装依赖
corepack enable
yarn install --immutable

# 构建 AppImage
yarn workspace dsh-plugin-desktop dist:linux-appimage

# 或构建 deb 包
yarn workspace dsh-plugin-desktop dist:linux-deb

# 或构建 rpm 包
yarn workspace dsh-plugin-desktop dist:linux-rpm
```

### 使用 Docker 构建

```bash
cd docker/linux-package
./build.sh
```

## 功能特性

### 已支持

- ✅ 原生桌面窗口集成
- ✅ 系统托盘图标
- ✅ 自动更新检查
- ✅ 插件市场
- ✅ 工作空间管理
- ✅ 终端集成
- ✅ 手机远程控制（即将推出）

### 平台特定说明

- **窗口装饰**: Linux 使用标准 GTK 窗口装饰
- **系统托盘**: 支持 GNOME、KDE、XFCE 等主流桌面环境
- **终端集成**: 自动检测已安装的终端模拟器（gnome-terminal、konsole、xfce4-terminal、xterm）

## 故障排除

### 应用无法启动

```bash
# 检查依赖
ldd /opt/DSH\ Desktop/dsh-desktop

# 以调试模式运行
./DSH-Desktop-*-x64.AppImage --enable-logging
```

### 权限问题

```bash
# AppImage 需要 FUSE 支持
sudo apt-get install -y libfuse2

# 或使用 --no-sandbox 参数（不推荐用于生产）
./DSH-Desktop-*-x64.AppImage --no-sandbox
```

### 系统托盘不显示

某些 Linux 桌面环境需要额外配置：

```bash
# GNOME 需要安装扩展
sudo apt-get install -y gnome-shell-extension-appindicator

# 或使用 StatusNotifierItem
```

## 获取帮助

- 查看 [常见问题](../docs/faq.md)
- 加入 Discord 社区
- 提交 GitHub Issue

## 许可证

DSH Desktop 遵循 MIT 许可证开源。
