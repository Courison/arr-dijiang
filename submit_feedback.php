<?php
/**
 * submit_feedback.php —— 反馈提交接口（安全加固版）
 * 需要 PHP 7.0+，建议开启 fileinfo 扩展
 *
 * 安全要点：
 *  - 使用 finfo_file + getimagesize 校验真实图片类型，不信任客户端 MIME
 *  - 随机文件名 + 随机子目录，防止枚举与路径猜测
 *  - 文本 500 字、最多 10 张图、总大小 5MB、单图 2MB
 *  - 基于 IP 的分钟/小时/每日限速
 *  - 任一步骤失败自动回滚已创建的目录
 *  - 不暴露错误细节，仅记录日志
 */

header('Content-Type: application/json; charset=utf-8');

error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);

// ============ 配置 ============
define('MAX_TEXT_LEN', 500);
define('MAX_FILES', 10);
define('MAX_TOTAL_SIZE', 5 * 1024 * 1024);   // 总 5MB
define('MAX_SINGLE_SIZE', 2 * 1024 * 1024);  // 单张 2MB
define('ALLOWED_MIME', ['image/jpeg', 'image/png', 'image/webp']);
define('MIME_EXT', ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp']);
define('BASE_DIR', __DIR__ . '/Suggest/');
define('RATE_DIR', BASE_DIR . '.ratelimit/');

// 限速策略
define('RATE_PER_MINUTE', 1);
define('RATE_PER_HOUR', 10);
define('RATE_PER_DAY', 30);

// ============ 工具函数 ============
function respond($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * 获取客户端 IP。
 * 默认只信任 REMOTE_ADDR。
 * 若站点前方有 CDN/反向代理，请在 Nginx 配置 real_ip 后再启用 X-Real-IP。
 */
function get_client_ip() {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    if (!filter_var($ip, FILTER_VALIDATE_IP)) {
        $ip = '0.0.0.0';
    }
    return $ip;
}

/**
 * 基于 IP 的滑动窗口限速。返回 ['ok'=>bool, 'message'=>string]
 */
function check_rate_limit($ip) {
    $now = time();

    if (!is_dir(RATE_DIR)) {
        @mkdir(RATE_DIR, 0700, true);
    }
    if (!is_dir(RATE_DIR)) {
        // 限速目录无法创建时不阻断主流程，只记录日志
        error_log('[feedback] 无法创建限速目录: ' . RATE_DIR);
        return ['ok' => true, 'message' => ''];
    }

    $file = RATE_DIR . hash('sha256', $ip) . '.json';
    $timestamps = [];
    if (is_file($file)) {
        $raw = @file_get_contents($file);
        if ($raw !== false) {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                $timestamps = $decoded;
            }
        }
    }

    // 只保留 24 小时内的记录
    $recent = [];
    foreach ($timestamps as $t) {
        if (is_int($t) && $now - $t < 86400) {
            $recent[] = $t;
        }
    }
    $timestamps = $recent;

    $inMinute = 0;
    $inHour = 0;
    foreach ($timestamps as $t) {
        if ($now - $t < 60)   $inMinute++;
        if ($now - $t < 3600) $inHour++;
    }

    if ($inMinute >= RATE_PER_MINUTE) {
        return ['ok' => false, 'message' => '提交过于频繁，请 1 分钟后再试'];
    }
    if ($inHour >= RATE_PER_HOUR) {
        return ['ok' => false, 'message' => '提交过于频繁，请稍后再试'];
    }
    if (count($timestamps) >= RATE_PER_DAY) {
        return ['ok' => false, 'message' => '今日提交次数已达上限'];
    }

    $timestamps[] = $now;
    @file_put_contents($file, json_encode($timestamps), LOCK_EX);
    return ['ok' => true, 'message' => ''];
}

/**
 * 递归删除目录（仅用于回滚本次创建的目录）
 */
function remove_dir_recursive($dir) {
    if (!is_dir($dir)) return;
    $items = @scandir($dir);
    if ($items === false) return;
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $path = $dir . DIRECTORY_SEPARATOR . $item;
        if (is_link($path)) {
            @unlink($path);
        } elseif (is_dir($path)) {
            remove_dir_recursive($path);
        } else {
            @unlink($path);
        }
    }
    @rmdir($dir);
}

/**
 * 文本长度（优先按字符数）
 */
function text_length($text) {
    if (function_exists('mb_strlen')) {
        return mb_strlen($text, 'UTF-8');
    }
    // 无 mbstring 时按字节估算，中文按 3 字节计算
    $len = 0;
    $chars = preg_split('//u', $text, -1, PREG_SPLIT_NO_EMPTY);
    if ($chars !== false) {
        return count($chars);
    }
    return strlen($text);
}

// ============ 主流程 ============
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(['success' => false, 'message' => 'Method Not Allowed'], 405);
}

// 1. 限速
$ip = get_client_ip();
$rate = check_rate_limit($ip);
if (!$rate['ok']) {
    respond(['success' => false, 'message' => $rate['message']], 429);
}

// 2. 文本校验
$text = isset($_POST['text']) ? trim((string)$_POST['text']) : '';
if ($text === '') {
    respond(['success' => false, 'message' => '反馈内容不能为空'], 400);
}
if (text_length($text) > MAX_TEXT_LEN) {
    respond(['success' => false, 'message' => '反馈内容不能超过 ' . MAX_TEXT_LEN . ' 字'], 400);
}

// 3. 上传基础校验
$files = $_FILES['images'] ?? null;
$hasFiles = $files
    && isset($files['name'])
    && is_array($files['name'])
    && count(array_filter($files['name'], function ($n) { return $n !== ''; })) > 0;

if ($hasFiles) {
    $fileCount = 0;
    $totalSize = 0;
    foreach ($files['name'] as $i => $name) {
        if ($name === '') continue;
        $fileCount++;
        $totalSize += (int)($files['size'][$i] ?? 0);
    }
    if ($fileCount > MAX_FILES) {
        respond(['success' => false, 'message' => '最多上传 ' . MAX_FILES . ' 张图片'], 400);
    }
    if ($totalSize > MAX_TOTAL_SIZE) {
        respond(['success' => false, 'message' => '图片总大小不能超过 5MB'], 400);
    }
}

// 4. 创建随机目录
if (!is_dir(BASE_DIR)) {
    if (!@mkdir(BASE_DIR, 0755, true)) {
        error_log('[feedback] 无法创建 Suggest 目录: ' . BASE_DIR);
        respond(['success' => false, 'message' => '服务暂时不可用'], 500);
    }
}
$dirName = date('Ymd_His') . '_' . bin2hex(random_bytes(6));
$subDir  = BASE_DIR . $dirName . '/';
if (!@mkdir($subDir, 0755, true)) {
    error_log('[feedback] 无法创建子目录: ' . $subDir);
    respond(['success' => false, 'message' => '服务暂时不可用'], 500);
}

// 5. 保存文本
$txtFile = $subDir . 'Suggest.txt';
if (@file_put_contents($txtFile, $text, LOCK_EX) === false) {
    remove_dir_recursive($subDir);
    error_log('[feedback] 文本保存失败: ' . $txtFile);
    respond(['success' => false, 'message' => '服务暂时不可用'], 500);
}
@chmod($txtFile, 0644);

// 6. 保存图片（真实类型校验 + 随机文件名）
$savedImages = [];
$errorMsg = '';

if ($hasFiles) {
    $finfo = function_exists('finfo_open') ? finfo_open(FILEINFO_MIME_TYPE) : null;
    if ($finfo === null) {
        remove_dir_recursive($subDir);
        error_log('[feedback] fileinfo 扩展未启用');
        respond(['success' => false, 'message' => '服务暂时不可用'], 500);
    }

    foreach ($files['tmp_name'] as $index => $tmpName) {
        if ($tmpName === '' || ($files['name'][$index] ?? '') === '') {
            continue;
        }

        $err = $files['error'][$index] ?? UPLOAD_ERR_NO_FILE;
        if ($err !== UPLOAD_ERR_OK) {
            $errorMsg = '图片上传失败';
            break;
        }

        $size = (int)($files['size'][$index] ?? 0);
        if ($size <= 0 || $size > MAX_SINGLE_SIZE) {
            $errorMsg = '单张图片不能超过 2MB';
            break;
        }

        // 真实 MIME
        $realType = @finfo_file($finfo, $tmpName);
        if ($realType === false || !in_array($realType, ALLOWED_MIME, true)) {
            $errorMsg = '仅支持 jpg/png/webp 图片';
            break;
        }

        // 图片完整性
        $imgInfo = @getimagesize($tmpName);
        if ($imgInfo === false) {
            $errorMsg = '图片文件损坏';
            break;
        }

        $ext      = MIME_EXT[$realType];
        $filename = bin2hex(random_bytes(8)) . '.' . $ext;
        $dest     = $subDir . $filename;

        if (!move_uploaded_file($tmpName, $dest)) {
            $errorMsg = '图片保存失败';
            break;
        }
        @chmod($dest, 0644);
        $savedImages[] = $filename;
    }

    finfo_close($finfo);
}

// 7. 回滚
if ($errorMsg !== '') {
    remove_dir_recursive($subDir);
    respond(['success' => false, 'message' => $errorMsg], 400);
}

// 8. 成功
respond([
    'success' => true,
    'message' => '反馈已保存',
    'folder'  => $dirName,
    'text'    => $text,
    'images'  => $savedImages,
]);