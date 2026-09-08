import 'package:flutter/material.dart';

import '../services/settings_repository.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _repository = SettingsRepository();
  final _athleteIdController = TextEditingController();
  final _apiKeyController = TextEditingController();
  final _bikeWeightController = TextEditingController(text: '8.0');
  bool _loading = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final credentials = await _repository.loadIntervalsIcuCredentials();
    final bikeWeight = await _repository.loadBikeWeightKg();
    if (!mounted) return;
    setState(() {
      _athleteIdController.text = credentials?.athleteId ?? '';
      _apiKeyController.text = credentials?.apiKey ?? '';
      if (bikeWeight != null) {
        _bikeWeightController.text = bikeWeight.toString();
      }
      _loading = false;
    });
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    await _repository.saveIntervalsIcuCredentials(
      athleteId: _athleteIdController.text.trim(),
      apiKey: _apiKeyController.text.trim(),
    );
    final bikeWeight = double.tryParse(_bikeWeightController.text.trim());
    if (bikeWeight != null) {
      await _repository.saveBikeWeightKg(bikeWeight);
    }
    if (!mounted) return;
    setState(() => _saving = false);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('設定を保存しました')),
    );
  }

  @override
  void dispose() {
    _athleteIdController.dispose();
    _apiKeyController.dispose();
    _bikeWeightController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('設定')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                const Text(
                  'intervals.icu (Settings > Developer Settings でAPIキーを発行)',
                  style: TextStyle(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _athleteIdController,
                  decoration: const InputDecoration(
                    labelText: 'Athlete ID (例: i123456)',
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _apiKeyController,
                  decoration: const InputDecoration(labelText: 'API Key'),
                  obscureText: true,
                ),
                const SizedBox(height: 24),
                const Text(
                  '自転車・装備重量',
                  style: TextStyle(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _bikeWeightController,
                  decoration: const InputDecoration(labelText: '重量 (kg)'),
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                ),
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: _saving ? null : _save,
                  child: Text(_saving ? '保存中...' : '保存'),
                ),
              ],
            ),
    );
  }
}
