-- Полный сброс пользователей и их данных. Контент (курсы, главы, активности,
-- задания, программа, организация) не трогаем.
--
-- Что происходит:
--   * явно чистятся три таблицы, у которых user_id без внешнего ключа:
--     code_submission, stat_snapshot, mediasharetoken;
--   * DELETE FROM "user" каскадом уносит всё пользовательское:
--     trail → trailrun → trailstep, сдачи заданий, сертификаты, записи в
--     программы, статистику, аудит, членство в организациях, сообщения, чаты,
--     голоса, уведомления, MFA, API-токены, агентов;
--   * у контента, созданного пользователями, ссылки обнуляются (SET NULL):
--     activity.last_modified_by_id, activityversion.created_by_id,
--     board.created_by, playground.created_by, editortemplate.creator_id,
--     editorvariable.creator_id.
--
-- Запуск (при остановленном app):
--   docker compose stop app
--   docker compose cp reset-users.sql "db:/tmp/reset-users.sql"
--   docker compose exec -T db psql -U learnhouse -d learnhouse -v ON_ERROR_STOP=1 -f /tmp/reset-users.sql
--   docker compose exec -T db rm -f /tmp/reset-users.sql
--
-- После этого пользователей нужно создать заново: seed-users.py.
BEGIN;

DELETE FROM code_submission;
DELETE FROM stat_snapshot;
DELETE FROM mediasharetoken;

DELETE FROM "user";

COMMIT;
