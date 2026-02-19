package com.example;

/**
 * Service for managing users.
 */
public class UserService {
    private final UserRepository repository;

    /**
     * Creates a new UserService.
     * @param repository the user repository
     */
    public UserService(UserRepository repository) {
        this.repository = repository;
    }

    /**
     * Find a user by ID.
     * @param id the user ID
     * @return the user or null if not found
     */
    public User findById(Long id) {
        if (id == null) {
            return null;
        }
        return repository.findById(id).orElse(null);
    }

    /**
     * Save a user.
     * @param user the user to save
     * @return the saved user
     */
    public User save(User user) {
        if (user == null) {
            throw new IllegalArgumentException("User must not be null");
        }
        return repository.save(user);
    }

    /**
     * Delete a user by ID.
     * @param id the user ID
     */
    public void deleteById(Long id) {
        if (id != null) {
            repository.deleteById(id);
        }
    }
}
