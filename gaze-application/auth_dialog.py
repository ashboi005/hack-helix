from __future__ import annotations

try:
    from PyQt6.QtCore import Qt
    from PyQt6.QtWidgets import (
        QApplication,
        QDialog,
        QFormLayout,
        QHBoxLayout,
        QLabel,
        QLineEdit,
        QMessageBox,
        QPushButton,
        QVBoxLayout,
    )
except ImportError as exc:  # pragma: no cover - GUI runtime guard
    raise RuntimeError(
        "Missing dependency 'PyQt6'. Install it with: pip install PyQt6"
    ) from exc

from auth_client import AuthSession, sign_in, sign_up


class AuthDialog(QDialog):
    def __init__(self, backend_url: str, default_email: str | None = None) -> None:
        super().__init__()
        self.backend_url = backend_url
        self.session: AuthSession | None = None

        self.setWindowTitle("Face Vector Sign In")
        self.setMinimumWidth(480)
        self.setModal(True)

        self.title_label = QLabel("Sign in or create an account to start face tracking.")
        self.title_label.setWordWrap(True)

        self.backend_label = QLabel(f"Backend: {backend_url}/auth/login and /auth/signup")
        self.backend_label.setWordWrap(True)
        self.backend_label.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)

        self.email_input = QLineEdit()
        self.email_input.setPlaceholderText("Email address")
        if default_email:
            self.email_input.setText(default_email)

        self.name_input = QLineEdit()
        self.name_input.setPlaceholderText("Full name for sign-up")

        self.password_input = QLineEdit()
        self.password_input.setPlaceholderText("Password")
        self.password_input.setEchoMode(QLineEdit.EchoMode.Password)

        form = QFormLayout()
        form.addRow("Name", self.name_input)
        form.addRow("Email", self.email_input)
        form.addRow("Password", self.password_input)

        self.status_label = QLabel("")
        self.status_label.setWordWrap(True)

        self.sign_in_button = QPushButton("Sign In")
        self.sign_up_button = QPushButton("Sign Up")
        self.cancel_button = QPushButton("Cancel")

        self.sign_in_button.clicked.connect(self.handle_sign_in)
        self.sign_up_button.clicked.connect(self.handle_sign_up)
        self.cancel_button.clicked.connect(self.reject)

        buttons = QHBoxLayout()
        buttons.addWidget(self.sign_in_button)
        buttons.addWidget(self.sign_up_button)
        buttons.addStretch(1)
        buttons.addWidget(self.cancel_button)

        layout = QVBoxLayout(self)
        layout.addWidget(self.title_label)
        layout.addWidget(self.backend_label)
        layout.addLayout(form)
        layout.addWidget(self.status_label)
        layout.addLayout(buttons)

    def _set_busy(self, busy: bool) -> None:
        for widget in (self.sign_in_button, self.sign_up_button, self.cancel_button):
            widget.setEnabled(not busy)
        self.status_label.setText("Working..." if busy else "")
        if busy:
            QApplication.setOverrideCursor(Qt.CursorShape.WaitCursor)
        elif QApplication.overrideCursor() is not None:
            QApplication.restoreOverrideCursor()

    def _collect_inputs(self, require_name: bool) -> tuple[str, str, str]:
        name = self.name_input.text().strip()
        email = self.email_input.text().strip()
        password = self.password_input.text()

        if require_name and not name:
            raise ValueError("Name is required for sign-up.")
        if not email:
            raise ValueError("Email is required.")
        if not password:
            raise ValueError("Password is required.")

        return name, email, password

    def _run_action(self, action: str) -> None:
        self._set_busy(True)
        try:
            require_name = action == "signup"
            name, email, password = self._collect_inputs(require_name=require_name)
            if action == "signup":
                self.session = sign_up(self.backend_url, name, email, password)
            else:
                self.session = sign_in(self.backend_url, email, password)
            self.accept()
        except Exception as exc:
            self._set_busy(False)
            self.status_label.setText(str(exc))
            QMessageBox.warning(self, "Authentication failed", str(exc))
        finally:
            self._set_busy(False)

    def handle_sign_in(self) -> None:
        self._run_action("signin")

    def handle_sign_up(self) -> None:
        self._run_action("signup")


def collect_auth_session(backend_url: str, default_email: str | None = None) -> AuthSession | None:
    app = QApplication.instance()
    if app is None:
        app = QApplication([])

    dialog = AuthDialog(backend_url=backend_url, default_email=default_email)
    result = dialog.exec()
    session = dialog.session if result == QDialog.DialogCode.Accepted else None

    return session
