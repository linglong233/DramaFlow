-- DropTypeEnum
-- ProjectPermission enum 是幽灵定义：schema 里声明了但没有任何 model 字段引用它
-- （权限运行时用 shared 的点号风格 "project.view"，存 Json 列）。删掉避免与 shared 契约混淆。
DROP TYPE "ProjectPermission";
