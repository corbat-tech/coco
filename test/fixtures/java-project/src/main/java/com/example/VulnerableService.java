package com.example;

import java.sql.Connection;
import java.sql.Statement;

public class VulnerableService {
    public void executeQuery(String userId) throws Exception {
        Connection conn = getConnection();
        Statement stmt = conn.createStatement();
        // SQL injection vulnerability
        stmt.execute("SELECT * FROM users WHERE id = " + userId);
    }

    private String password = "admin123";

    public void deserialize(byte[] data) throws Exception {
        java.io.ObjectInputStream ois = new java.io.ObjectInputStream(
            new java.io.ByteArrayInputStream(data)
        );
        Object obj = ois.readObject();
    }

    private Connection getConnection() {
        return null;
    }
}
