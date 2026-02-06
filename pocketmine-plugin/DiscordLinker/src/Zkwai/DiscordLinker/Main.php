<?php

declare(strict_types=1);

namespace Zkwai\DiscordLinker;

use pocketmine\command\Command;
use pocketmine\command\CommandSender;
use pocketmine\console\ConsoleCommandSender;
use pocketmine\event\Listener;
use pocketmine\event\player\PlayerJoinEvent;
use pocketmine\player\Player;
use pocketmine\plugin\PluginBase;

final class Main extends PluginBase implements Listener
{
    private string $botUrl = '';
    private string $linkSecret = '';
    private int $timeoutSeconds = 8;

    protected function onEnable(): void
    {
        $this->saveDefaultConfig();
        $this->botUrl = rtrim((string) $this->getConfig()->get('botUrl', ''), '/');
        $this->linkSecret = (string) $this->getConfig()->get('linkSecret', '');
        $this->timeoutSeconds = (int) $this->getConfig()->get('timeoutSeconds', 8);

        $this->getServer()->getPluginManager()->registerEvents($this, $this);
    }

    public function onCommand(CommandSender $sender, Command $command, string $label, array $args): bool
    {
        switch ($command->getName()) {
            case 'link':
                if (!($sender instanceof Player)) {
                    $sender->sendMessage('In-game only.');
                    return true;
                }
                $result = $this->request('POST', '/link/code', ['gamertag' => $sender->getName()]);
                if (!$result['ok']) {
                    $sender->sendMessage('Link error: ' . $result['error']);
                    return true;
                }
                $code = $result['data']['code'] ?? null;
                if (!$code) {
                    $sender->sendMessage('Link error: no code received.');
                    return true;
                }
                $sender->sendMessage('Discord link code: ' . $code);
                $sender->sendMessage('Use /link ' . $code . ' on Discord.');
                return true;

            case 'unlink':
                if (!($sender instanceof Player)) {
                    $sender->sendMessage('In-game only.');
                    return true;
                }
                $result = $this->request('POST', '/link/unlink', ['gamertag' => $sender->getName()]);
                if (!$result['ok']) {
                    $sender->sendMessage('Unlink error: ' . $result['error']);
                    return true;
                }
                $removed = (bool) ($result['data']['removed'] ?? false);
                $sender->sendMessage($removed ? 'Link removed.' : 'No link found.');
                return true;
        }

        return false;
    }

    public function onPlayerJoin(PlayerJoinEvent $event): void
    {
        $player = $event->getPlayer();
        $result = $this->request('GET', '/link/resolve', null, ['gamertag' => $player->getName()]);
        if (!$result['ok']) {
            return;
        }
        if (!($result['data']['linked'] ?? false)) {
            return;
        }
        $group = $result['data']['group'] ?? null;
        if (!is_string($group) || $group === '') {
            return;
        }
        $this->applyGroup($player, $group);
    }

    private function applyGroup(Player $player, string $group): void
    {
        $command = 'setgroup ' . $player->getName() . ' ' . $group;
        $sender = new ConsoleCommandSender($this->getServer(), $this->getServer()->getLanguage());
        $this->getServer()->dispatchCommand($sender, $command);
    }

    private function request(string $method, string $path, ?array $body = null, ?array $query = null): array
    {
        if ($this->botUrl === '') {
            return ['ok' => false, 'error' => 'botUrl_not_set'];
        }

        $url = $this->botUrl . $path;
        if ($query && count($query) > 0) {
            $url .= '?' . http_build_query($query);
        }

        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            $headers = ['Content-Type: application/json'];
            if ($this->linkSecret !== '') {
                $headers[] = 'x-link-secret: ' . $this->linkSecret;
            }
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_TIMEOUT, $this->timeoutSeconds);
            curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
            curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
            if ($body !== null) {
                $payload = json_encode($body);
                curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
            }
            $response = curl_exec($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $error = curl_error($ch);
            curl_close($ch);

            if ($response === false) {
                return ['ok' => false, 'error' => $error ?: 'request_failed'];
            }

            $data = json_decode($response, true);
            if (!is_array($data)) {
                $data = null;
            }

            return [
                'ok' => $status >= 200 && $status < 300,
                'status' => $status,
                'data' => $data,
                'error' => $status >= 200 && $status < 300 ? null : ($data['error'] ?? 'http_error')
            ];
        }

        return ['ok' => false, 'error' => 'curl_not_available'];
    }
}
