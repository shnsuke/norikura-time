import 'package:flutter/material.dart';

import 'screens/home_screen.dart';

void main() {
  runApp(const NorikuraTimeApp());
}

class NorikuraTimeApp extends StatelessWidget {
  const NorikuraTimeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '乗鞍タイム予測',
      theme: ThemeData(colorSchemeSeed: Colors.teal, useMaterial3: true),
      home: const HomeScreen(),
    );
  }
}
