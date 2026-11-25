-- Сброс прогресса и активности на тестовом стенде.
-- Аккаунты, пароли и контент (курсы, доски, сообщества) остаются.
--
-- Запуск:
--   docker compose exec -T db psql -U learnhouse -d learnhouse \
--     -f /dev/stdin < reset-progress.sql
--
-- Порядок важен: trailstep ссылается на trailrun и trail.
BEGIN;

DELETE FROM trailstep;
DELETE FROM trailrun;
DELETE FROM trail;

DELETE FROM assignmenttasksubmission;
DELETE FROM assignmentusersubmission;

DELETE FROM certificateuser;
DELETE FROM pathcertificate;
DELETE FROM pathenrollment;

DELETE FROM user_activity_day;

DELETE FROM code_submission;
DELETE FROM informatics_submission;

DELETE FROM discussioncommentvote;
DELETE FROM discussionvote;
DELETE FROM drip_notification;

COMMIT;
