-- RefreshToken.tokenHash 改为可检索的唯一索引（SHA-256 哈希）。
-- 原先用 argon2 慢哈希存储，导致 refresh/logout 必须全表扫描 + 逐行 verify，
-- 存在性能与 DoS 放大风险。高熵随机 token 用 SHA-256 即可安全标识。
-- 存量 argon2 哈希不可逆推，无法回填，故清空表（用户需重新登录）。
TRUNCATE TABLE "RefreshToken";

CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
