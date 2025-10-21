import subprocess
import webbrowser
import tkinter as tk
from tkinter import scrolledtext
import threading
import time
import platform
import requests
import json
import os

class AppLauncher(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Titan System Launcher")
        self.configure(bg="#0d1117")
        try:
            self.state('zoomed') # Maximize window
        except tk.TclError:
            self.geometry("1200x800") # Fallback

        self.service_processes = {}
        self.log_threads = []
        self.stop_event = threading.Event()

        self.create_widgets()

    def create_widgets(self):
        main_frame = tk.Frame(self, bg="#0d1117")
        main_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        left_frame = tk.Frame(main_frame, bg="#0d1117", width=350)
        left_frame.pack(side=tk.LEFT, fill=tk.Y, padx=(0, 10))
        left_frame.pack_propagate(False)
        
        right_frame = tk.Frame(main_frame, bg="#0d1117")
        right_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        header_frame = tk.Frame(left_frame, bg="#0d1117")
        header_frame.pack(pady=20)
        
        self.rocket_canvas = tk.Canvas(header_frame, width=100, height=100, bg="#0d1117", highlightthickness=0)
        self.rocket_canvas.pack()
        
        self.rocket_body = self.rocket_canvas.create_polygon(50, 10, 70, 40, 60, 40, 60, 70, 40, 70, 40, 40, 30, 40, fill="#c9d1d9", outline="#58a6ff", width=2)
        self.rocket_fin1 = self.rocket_canvas.create_polygon(40, 70, 40, 85, 25, 85, fill="#58a6ff")
        self.rocket_fin2 = self.rocket_canvas.create_polygon(60, 70, 60, 85, 75, 85, fill="#58a6ff")
        self.flame = self.rocket_canvas.create_polygon(45, 75, 55, 75, 50, 90, fill="orange", state=tk.HIDDEN)

        title_label = tk.Label(header_frame, text="TITAN LAUNCH CONTROL", font=("Inter", 16, "bold"), fg="#c9d1d9", bg="#0d1117")
        title_label.pack(pady=10)

        controls_frame = tk.Frame(left_frame, bg="#161b22", bd=1, relief=tk.SOLID)
        controls_frame.pack(pady=10, padx=20, fill=tk.X)

        self.service_widgets = {}
        self.commands = {
            "Auth Service": ("node -u auth-service.js", 3001),
            "Inventory Service": ("node -u inventory-service.js", 3002),
            "Order Service": ("node -u order-service.js", 3003),
            "Frontend Server": ("npx serve -l 3000", None) 
        }

        for name, (cmd, port) in self.commands.items():
            frame = tk.Frame(controls_frame, bg="#161b22")
            frame.pack(fill=tk.X, padx=10, pady=8)
            
            label = tk.Label(frame, text=f"{name}:", font=("Inter", 10), fg="#8b949e", bg="#161b22", width=15, anchor='w')
            label.pack(side=tk.LEFT)

            status = tk.Label(frame, text="OFFLINE", font=("Inter", 10, "bold"), fg="red", bg="#161b22", width=8)
            status.pack(side=tk.LEFT, padx=5)

            start_btn = tk.Button(frame, text="Start", bg="#238636", fg="white", relief=tk.FLAT, command=lambda n=name, c=cmd, p=port: self.start_service(n, c, p))
            start_btn.pack(side=tk.LEFT, padx=2)
            
            stop_btn = tk.Button(frame, text="Stop", bg="#da3633", fg="white", relief=tk.FLAT, state=tk.DISABLED, command=lambda n=name, p=port: self.stop_service(n, p))
            stop_btn.pack(side=tk.LEFT, padx=2)

            self.service_widgets[name] = {'status': status, 'start_btn': start_btn, 'stop_btn': stop_btn}
        
        action_frame = tk.Frame(left_frame, bg="#0d1117")
        action_frame.pack(pady=20, fill=tk.X, padx=20)
        
        self.quick_launch_button = tk.Button(action_frame, text="🚀 Quick Launch", font=("Inter", 12, "bold"), bg="#3b82f6", fg="white", relief=tk.FLAT, command=self.start_quick_launch, borderwidth=0, padx=15, pady=8)
        self.quick_launch_button.pack(side=tk.TOP, expand=True, fill=tk.X, pady=5)
        
        self.shutdown_button = tk.Button(action_frame, text="Shutdown All", font=("Inter", 12, "bold"), bg="#6e7681", fg="white", relief=tk.FLAT, command=self.on_closing, borderwidth=0, padx=15, pady=8)
        self.shutdown_button.pack(side=tk.TOP, expand=True, fill=tk.X, pady=5)
        
        log_label = tk.Label(right_frame, text="System Logs", font=("Inter", 14, "bold"), fg="#c9d1d9", bg="#0d1117")
        log_label.pack(anchor='w', pady=(0, 10))
        
        self.log_text = scrolledtext.ScrolledText(right_frame, wrap=tk.WORD, bg="#010409", fg="#c9d1d9", relief=tk.SOLID, bd=1, font=("Courier New", 12))
        self.log_text.pack(fill=tk.BOTH, expand=True)
        self.log_text.tag_config('Auth', foreground='#388bfd')
        self.log_text.tag_config('Inventory', foreground='#3fb950')
        self.log_text.tag_config('Order', foreground='#f0883e')
        self.log_text.tag_config('Frontend', foreground='#a371f7')
        self.log_text.tag_config('ERROR', foreground='red', font=("Courier New", 12, "bold"))
        
    def animate_rocket(self):
        for i in range(10):
            self.rocket_canvas.move(self.rocket_body, 0, -1)
            self.rocket_canvas.move(self.rocket_fin1, 0, -1)
            self.rocket_canvas.move(self.rocket_fin2, 0, -1)
            self.rocket_canvas.itemconfig(self.flame, state=tk.NORMAL if i % 2 == 0 else tk.HIDDEN)
            self.update()
            time.sleep(0.05)
        self.rocket_canvas.itemconfig(self.flame, state=tk.NORMAL)

    def update_status(self, service, text, color):
        if service in self.service_widgets:
            self.service_widgets[service]['status'].config(text=text, fg=color)

    def log_from_stream(self, stream, service_name):
        for line in iter(stream.readline, ''):
            if self.stop_event.is_set(): break
            self.after(0, self.update_log_display, line, service_name)
        stream.close()
    
    def update_log_display(self, line, service_name):
        if line.strip().startswith('LOG::'):
            try:
                log_data = json.loads(line.strip().replace('LOG::', ''))
                service = log_data.get('service', service_name)
                message = log_data.get('message', '')
                
                tag = "ERROR" if "error" in message.lower() or "fail" in message.lower() else service.split()[0]
                
                self.log_text.insert(tk.END, f"[{service}] ", tag)
                self.log_text.insert(tk.END, f"{message}\n")
                self.log_text.see(tk.END)
            except (json.JSONDecodeError, IndexError):
                pass
        elif service_name == "Frontend Server" and ("Accepting connections" in line or "GET" in line or "serving" in line):
             self.log_text.insert(tk.END, f"[{service_name}] ", "Frontend")
             self.log_text.insert(tk.END, f"{line.strip()}\n")
             self.log_text.see(tk.END)

    def launch_service(self, command, service_name, port):
        try:
            use_shell = platform.system() == "Windows"
            creation_flags = subprocess.CREATE_NO_WINDOW if use_shell else 0
            
            cmd_to_run = command if use_shell else command.split()

            process = subprocess.Popen(cmd_to_run, shell=use_shell, creationflags=creation_flags,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', bufsize=1)
            self.service_processes[service_name] = process
            
            stdout_thread = threading.Thread(target=self.log_from_stream, args=(process.stdout, service_name), daemon=True)
            stderr_thread = threading.Thread(target=self.log_from_stream, args=(process.stderr, service_name), daemon=True)
            stdout_thread.start()
            stderr_thread.start()
            self.log_threads.extend([stdout_thread, stderr_thread])
            
            self.after(0, self.update_status, service_name, "ONLINE", "green")
            self.after(0, lambda: self.service_widgets[service_name]['start_btn'].config(state=tk.DISABLED))
            self.after(0, lambda: self.service_widgets[service_name]['stop_btn'].config(state=tk.NORMAL))
        except Exception as e:
            self.after(0, self.update_status, service_name, "ERROR", "red")
            print(f"Error starting {service_name}: {e}")

    def start_service(self, name, command, port):
        threading.Thread(target=self.launch_service, args=(command, name, port)).start()
        
    def stop_service(self, name, port):
        if name in self.service_processes:
            process = self.service_processes[name]
            
            if port:
                try:
                    requests.post(f"http://localhost:{port}/shutdown", timeout=2)
                    time.sleep(1) 
                except requests.exceptions.RequestException:
                    print(f"Graceful shutdown for {name} failed. Forcing termination.")
            
            if process.poll() is None:
                try:
                    if platform.system() == "Windows":
                        subprocess.run(f"taskkill /F /T /PID {process.pid}", check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    else:
                        process.terminate()
                        process.wait(timeout=2)
                except Exception as e:
                    print(f"Could not terminate process {name} (PID: {process.pid}): {e}")
            
            del self.service_processes[name]
            self.update_status(name, "OFFLINE", "red")
            self.service_widgets[name]['start_btn'].config(state=tk.NORMAL)
            self.service_widgets[name]['stop_btn'].config(state=tk.DISABLED)

    def start_quick_launch(self):
        threading.Thread(target=self.quick_launch_sequence).start()

    def quick_launch_sequence(self):
        self.quick_launch_button.config(state=tk.DISABLED)
        self.animate_rocket()

        for name, (cmd, port) in self.commands.items():
            if name not in self.service_processes:
                self.start_service(name, cmd, port)
                time.sleep(1.5)

        try:
            webbrowser.open("http://localhost:3000")
        except Exception as e:
            print(f"Error opening browser: {e}")
            
        self.quick_launch_button.config(text="System Online", bg="#30363d")

    def on_closing(self):
        print("Shutting down all services...")
        self.stop_event.set()
        for name, (cmd, port) in self.commands.items():
            if name in self.service_processes:
                self.stop_service(name, port)
        
        for thread in self.log_threads:
            if thread.is_alive():
                thread.join(timeout=1)
        
        self.destroy()

if __name__ == "__main__":
    app = AppLauncher()
    app.protocol("WM_DELETE_WINDOW", app.on_closing)
    app.mainloop()