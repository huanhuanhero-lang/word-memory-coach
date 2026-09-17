#!/usr/bin/env python3
"""带 no-cache 头的静态服务，专门解决 Python http.server 的强缓存问题"""
import http.server
import socketserver

PORT = 8090

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

with socketserver.TCPServer(("", PORT), NoCacheHandler) as httpd:
    print(f"serving at port {PORT} with no-cache headers")
    httpd.serve_forever()